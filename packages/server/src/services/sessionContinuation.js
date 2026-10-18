import { sessions, messages, attachments, conversations } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';
import { claimSessionExecution, createExecutionConflictError, getSessionExecutionConflict } from './sessionExecutionOwnership.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import { handlePreparationFailure } from './sessionExecution.js';
import { executeContinueAttempt, prepareContinueAttempt } from './sessionContinueDispatch.js';
import { activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution } from './sessionStartResult.js';

/**
 * Validate the ownership claim for a branch continue, then fetch the session,
 * conversation, and last user message it needs. Shared with sessionManager's
 * branch path so both continue entries enforce the same admission contract.
 */
export function validateAndFetchContinueContext(sessionId, conversationId) {
  const conflict = getSessionExecutionConflict(sessionId);
  if (conflict) {
    throw createExecutionConflictError(sessionId, conflict.phase);
  }
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  const conversation = conversations.getById(conversationId);
  if (!conversation || conversation.sessionId !== sessionId) {
    throw new Error('Conversation not found');
  }
  const conversationMessages = messages.getByConversationId(conversationId);
  const lastUserMessage = [...conversationMessages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation');
  }
  return { session, conversation, lastUserMessage };
}

/**
 * Set up the active conversation, create the user message, broadcast it,
 * associate attachments, and build the prompt with attachment context.
 * @returns {{ activeConversation: Object, promptWithAttachments: string }}
 */
async function setupConversationAndMessage(sessionId, content, fileAttachments) {
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);

  const message = messages.create(sessionId, 'user', content, { toolUse: null, conversationId: activeConversation.id });

  // Touch the session to update its updated_at timestamp so it sorts to the top
  sessions.touch(sessionId);

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId: activeConversation.id,
  });

  if (fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, message.id);
  }

  const promptWithAttachments = buildPromptWithAttachments(content, fileAttachments);
  return { activeConversation, promptWithAttachments };
}

/**
 * Continue a session with a follow-up message (core implementation)
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 */
/**
 * Fetch the session and enforce lane-run ownership admission for a
 * continuation. Returns `{ rejected }` when the turn must not start.
 */
function fetchAdmittedContinueSession(sessionId, interactive) {
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  // A scheduled/automatic continuation can race with a manual card move that
  // revokes its lane-run ownership. Reject before registering active state,
  // creating a user message, or changing the session status.
  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return { rejected: rejectedSessionExecution(sessionId, 'lane_run_ownership_lost') };
  }
  return { session };
}

/**
 * Create the turn's single user message and mark the session running.
 */
async function openContinueTurn(sessionId, content, fileAttachments) {
  const setup = await setupConversationAndMessage(sessionId, content, fileAttachments);
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');
  return setup;
}

export async function continueSessionCore(sessionId, content, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { systemPrompt = null, fileAttachments = [], model = null, providerId = null, interactive = false } = options;

  const admitted = fetchAdmittedContinueSession(sessionId, interactive);
  if (admitted.rejected) return admitted.rejected;

  const controller = new AbortController();
  // Atomically claim execution ownership. Throws a 409-coded conflict when a
  // live turn (running or still shutting down after a Stop) owns the session.
  claimSessionExecution(sessionId, controller);

  // Preparation runs BEFORE provider dispatch and outside _executeSession's
  // own error/finally boundary: any failure here must fail the turn
  // explicitly instead of wedging the session as permanently running. The
  // flag keeps _executeSession's own — already handled — failures out of
  // that path: they propagate unchanged.
  let providerDispatched = false;
  try {
    const { activeConversation, promptWithAttachments } = await openContinueTurn(sessionId, content, fileAttachments);

    // At most two dispatches per turn: the initial attempt plus one tier-
    // failover retry (§5.2). The retry re-resolves (the failed member is
    // cooled by then, so §5.1 advances) and carries the failed turn's
    // transcript with a boundary marker instead of re-executing it.
    const turn = { session: admitted.session, failoverBoundary: null, unsettledError: null };
    const attemptOpts = {
      model, providerId, systemPrompt, activeConversation, promptWithAttachments,
      workingDirectory, controller, callbacks, interactive,
    };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptCtx = { ...attemptOpts, firstAttempt: attempt === 1 };
      const prepared = await prepareContinueAttempt(sessionId, turn, attemptCtx);
      if (prepared.settled) return prepared.settled;
      Object.assign(turn, { session: prepared.session });
      providerDispatched = true;
      const outcome = await executeContinueAttempt(sessionId, turn, prepared.dispatch, attemptCtx);
      if (outcome.completed) return outcome.result;
    }
    throw new Error('Continue session retry loop exited without dispatching');
  } catch (error) {
    if (!providerDispatched) {
      handlePreparationFailure({ sessionId, controller, error, includeConversationId: true });
    }
    throw error;
  }
}
