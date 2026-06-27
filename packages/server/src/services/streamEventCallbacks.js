import { sessions, conversations, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import * as kanbanService from './kanbanService.js';
import { createVisibleFinalErrorMessage } from './visibleFinalErrorMessage.js';
import {
  lastMessageIds,
  activeSessions,
  activeConversationIds,
  finalErrorSessionIds,
  associateAndBroadcastWorkLogs,
  broadcastSessionStatus,
  broadcastChangesUpdate,
} from './streamEventHandler.js';

/**
 * Re-apply scheduled status after turn completion if the session was scheduled
 * mid-turn (e.g., by the agent calling POST /api/sessions/:id/schedule).
 *
 * The turn-completion sequence first writes status='waiting'; this hook reads
 * the session back and overrides it to 'scheduled' when a future scheduledAt
 * and a pendingPrompt are present. Mirrors checkProactiveReschedule: returns
 * true (short-circuit) when it fires so auto-send and template triggers are
 * skipped for this turn.
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function handleScheduledContinuationIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session) return false;
  if (session.scheduledAt && session.scheduledAt > Date.now() && session.pendingPrompt) {
    sessions.update(sessionId, { status: 'scheduled' });
    broadcastSessionStatus(sessionId, 'scheduled');
    return true;
  }
  return false;
}

/**
 * Associate work logs with the last message and clean up tracking state.
 * @param {string} sessionId
 */
function associateAndCleanupWorkLogs(sessionId) {
  const lastMessageId = lastMessageIds.get(sessionId);
  if (lastMessageId) {
    associateAndBroadcastWorkLogs(sessionId, lastMessageId);
    lastMessageIds.delete(sessionId);
  }
}

/**
 * Handle post-turn activities for a session that's ready for follow-up.
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {{ checkProactiveReschedule?: Function, handleAutoSendIfNeeded?: Function, handleTemplateTriggerIfNeeded?: Function }} callbacks
 * @returns {Promise<boolean>} True if rescheduled, false otherwise
 */
async function handleActiveSessionCompletion(sessionId, workingDirectory, callbacks) {
  sessions.update(sessionId, { status: 'waiting', error: null });
  broadcastSessionStatus(sessionId, 'waiting');

  // Check if session should be proactively rescheduled based on token threshold
  const { checkProactiveReschedule } = callbacks;
  if (checkProactiveReschedule) {
    const wasRescheduled = await checkProactiveReschedule(sessionId);
    if (wasRescheduled) {
      return true; // Session was rescheduled, don't continue with normal completion
    }
  }

  // Re-apply scheduled status if the agent called POST /:id/schedule mid-turn.
  // The waiting write above would otherwise overwrite the scheduled state.
  const wasScheduledMidTurn = await handleScheduledContinuationIfNeeded(sessionId);
  if (wasScheduledMidTurn) {
    return true; // Session stays scheduled, skip auto-send and template triggers
  }

  // Extract PR URL immediately (lightweight, no API call)
  summaryService.extractPrUrlIfNeeded(sessionId);
  // Trigger debounced summary generation on turn completion (not complete yet)
  summaryService.onSessionActivity(sessionId);

  // Broadcast changes update when turn completes (real-time indicator)
  const currentSession = sessions.getById(sessionId);
  if (currentSession) {
    await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
  }

  // Advance the card to its current lane's completion target now that the
  // session has finished a turn successfully. This is the only correct
  // trigger: work was actually done while parked in this lane.
  await kanbanService.handleCompletionMove(sessionId);

  // Auto-send queued prompt if enabled (runs BEFORE template trigger)
  const { handleAutoSendIfNeeded, handleTemplateTriggerIfNeeded } = callbacks;
  let autoSendFired = false;
  if (handleAutoSendIfNeeded) {
    autoSendFired = await handleAutoSendIfNeeded(sessionId);
  }

  // Only trigger next template if auto-send did NOT fire
  // (if auto-send fired, template will trigger after that turn completes)
  if (!autoSendFired && handleTemplateTriggerIfNeeded) {
    await handleTemplateTriggerIfNeeded(sessionId);
  }

  return false;
}

/**
 * Handle post-turn completion logic (after stream loop ends successfully)
 * Encapsulates the duplicated completion block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {string} workingDirectory
 * @param {{ handleTemplateTriggerIfNeeded?: Function, checkProactiveReschedule?: Function, handleAutoSendIfNeeded?: Function }} callbacks
 */
export async function handleTurnCompletion(sessionId, workingDirectory, callbacks = {}) {
  // Associate work logs with the last message now that the turn is complete
  associateAndCleanupWorkLogs(sessionId);

  // Sessions with final errors should not transition to waiting
  if (finalErrorSessionIds.has(sessionId)) {
    finalErrorSessionIds.delete(sessionId);
    return false;
  }

  // Session ready for follow-up - set to waiting instead of completed
  const activeSession = activeSessions.get(sessionId);
  if (activeSession && !activeSession.controller?.signal?.aborted) {
    return handleActiveSessionCompletion(sessionId, workingDirectory, callbacks);
  }

  return false;
}

/**
 * Determine retry mode for a session error reschedule.
 * Returns { retryExistingMessage, conversationId }.
 *
 * If the active conversation has a last user message and no assistant message
 * after it, we retry the existing user message (no duplicate). Otherwise we
 * schedule a "Continue" prompt.
 *
 * @param {string} sessionId
 * @returns {{ retryExistingMessage: boolean, conversationId: string|null }}
 */
function computeRetryMode(sessionId) {
  const activeConversationId = activeConversationIds.get(sessionId);
  if (!activeConversationId) {
    return { retryExistingMessage: false, conversationId: null };
  }

  const convMessages = messages.getByConversationId(activeConversationId);
  // Find the last user message index and whether an assistant message follows it
  let lastUserIndex = -1;
  for (let i = convMessages.length - 1; i >= 0; i--) {
    if (convMessages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    // No user message found — can't retry existing message
    return { retryExistingMessage: false, conversationId: null };
  }

  const hasAssistantAfterLastUser = convMessages
    .slice(lastUserIndex + 1)
    .some(m => m.role === 'assistant');

  if (!hasAssistantAfterLastUser) {
    // The turn hasn't started yet: retry the existing user message
    return { retryExistingMessage: true, conversationId: activeConversationId };
  }

  // Partial turn already has assistant content: next attempt should Continue
  return { retryExistingMessage: false, conversationId: null };
}

/**
 * Try to reschedule the session due to an error.
 * Returns true if rescheduled, false otherwise.
 * @param {string} sessionId
 * @param {Error} error
 * @param {Function} shouldRescheduleOnError
 * @param {Object} schedulerService
 * @returns {Promise<boolean>}
 */
async function tryRescheduleOnError(sessionId, error, shouldRescheduleOnError, schedulerService) {
  const session = sessions.getById(sessionId);
  if (!session || !shouldRescheduleOnError(session, error, sessionId)) {
    return false;
  }

  // Determine retry mode: re-use existing user message or send "Continue"
  const { retryExistingMessage, conversationId } = computeRetryMode(sessionId);

  const rescheduled = await schedulerService.rescheduleSession(
    sessionId,
    error.message,
    { retryExistingMessage, conversationId }
  );
  if (rescheduled) {
    console.log(`[SessionManager] Session ${sessionId} rescheduled due to error (retryExistingMessage=${retryExistingMessage})`);
    return true;
  }
  return false;
}

/**
 * Broadcast the final conversation state for error handling.
 * @param {string} sessionId
 */
function broadcastFinalConversationState(sessionId) {
  const errorConversationId = activeConversationIds.get(sessionId);
  const finalConversation = errorConversationId
    ? conversations.getById(errorConversationId)
    : null;
  if (finalConversation) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
      sessionId,
      conversation: finalConversation,
    });
  }
  broadcastSessionStatus(sessionId, 'error');
}

/**
 * Safely trigger the template handler, catching any errors.
 * @param {string} sessionId
 * @param {Function} handleTemplateTriggerIfNeeded
 */
async function safeTriggerTemplate(sessionId, handleTemplateTriggerIfNeeded) {
  try {
    await handleTemplateTriggerIfNeeded(sessionId);
  } catch (templateError) {
    console.error(`[handleSessionError] Template trigger failed for session ${sessionId}:`, templateError);
  }
}

/**
 * Handle session error with optional rescheduling
 * Encapsulates the duplicated error handling block from runSession/continueSession/continueSessionWithExistingMessage
 * @param {string} sessionId
 * @param {Error} error
 * @param {{ controller: AbortController, shouldRescheduleOnError: Function, schedulerService: Object, errorLabel?: string, broadcastConversationState?: boolean, handleTemplateTriggerIfNeeded?: Function }} options
 */
export async function handleSessionError(sessionId, error, options = {}) {
  const { controller, shouldRescheduleOnError, schedulerService } = options;
  const errorLabel = options.errorLabel || 'Session error';
  console.error(`${errorLabel}:`, error);
  console.error('Error stack:', error.stack);

  if (controller.signal.aborted) {
    return false;
  }

  // Check if we should reschedule instead of marking as error
  const rescheduled = await tryRescheduleOnError(sessionId, error, shouldRescheduleOnError, schedulerService);
  if (rescheduled) {
    return true;
  }

  // Normal error handling (no reschedule or reschedule limits reached)
  sessions.update(sessionId, { status: 'error', error: error.message });
  createVisibleFinalErrorMessage(sessionId, error, activeConversationIds);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });

  // Optionally broadcast final conversation state (continueSession does this)
  if (options.broadcastConversationState) {
    broadcastFinalConversationState(sessionId);
  }

  // Extract PR URL before generating summary (PR may have been created before error)
  summaryService.extractPrUrlIfNeeded(sessionId);
  // Trigger summary generation on error
  summaryService.onSessionComplete(sessionId);

  // Trigger next template if configured (e.g., session completed work but process exited with error code)
  if (options.handleTemplateTriggerIfNeeded) {
    await safeTriggerTemplate(sessionId, options.handleTemplateTriggerIfNeeded);
  }

  return false; // Not rescheduled
}
