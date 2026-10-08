/**
 * Turn setup for session executions: everything between admission and the
 * provider call (conversation/message creation, status transition, agent
 * creation, model resolution, query-param building).
 *
 * Each `prepare*` function atomically claims execution ownership first and
 * releases that claim if setup fails before `_executeSession` takes over, so
 * a setup failure can never wedge a session. Once setup succeeds, ownership
 * belongs to the turn and is released only by `_executeSession`'s finalizer
 * after the provider generator has settled.
 */

import { sessions, messages, attachments, conversations } from '../database.js';
import { resolveProviderFromModel, resolveProviderMetadataFromModel, buildSessionEnv } from './sessionProvider.js';
import { reconcileAgentTypeForRun, deriveAgentTypeUpdate } from './sessionAgentGuard.js';
import { buildAgentEnv, createAgentForSession } from './sessionAgentConfig.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import {
  activeConversationIds, cleanupSessionState, broadcastSessionStatus,
} from './streamEventHandler.js';
import { claimSessionExecution, isSessionExecutionConflictError } from './sessionExecutionOwnership.js';
import { buildConversationContextForModelSwitch, buildConversationContextForContinuation } from './conversationContext.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { closeOwnWork } from './workflowSessionService.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { isUserStopAbort } from './sessionAbort.js';

async function resolveInitialSessionModelEnv(session, model) {
  const effectiveModel = model || session.model;
  const { commitAttributionOverride = null } = resolveProviderMetadataFromModel(effectiveModel) || {};

  if (session.gitWorktree && commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  const baseSessionEnv = buildSessionEnv(resolveProviderFromModel(effectiveModel), session.thinkingEnabled, session.effortLevel);
  return { effectiveModel, sessionEnv: buildAgentEnv(baseSessionEnv, commitAttributionOverride), commitAttributionOverride };
}

/**
 * Build prompt with conversation context for a continuation.
 */
async function buildPromptForContinue({ modelChanged, agent, conversationId, prompt }) {
  if (modelChanged) {
    return buildConversationContextForModelSwitch(conversationId) + prompt;
  }
  if (agent.needsConversationContext()) {
    return buildConversationContextForContinuation(conversationId) + prompt;
  }
  return prompt;
}

/**
 * Resolve model/provider and build session environment for a continue operation.
 */
function buildContinueModelAndEnv(session, sessionId, model) {
  const effectiveModel = model || session.model;

  const provider = resolveProviderFromModel(effectiveModel);
  const providerMetadata = resolveProviderMetadataFromModel(effectiveModel);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;
  const sessionEnv = buildAgentEnv(
    buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel),
    commitAttributionOverride
  );

  const modelChanged = Boolean(model && session.model && model !== session.model);

  let updatedSession = session;
  const agentTypeUpdate = effectiveModel ? deriveAgentTypeUpdate(session, sessionId, effectiveModel, { providerId: session.providerId }) : {};
  if (model || Object.keys(agentTypeUpdate).length > 0) {
    sessions.update(sessionId, { ...(model && { model }), ...agentTypeUpdate });
    updatedSession = sessions.getById(sessionId);
  }

  return {
    effectiveModel,
    sessionEnv,
    commitAttributionOverride,
    modelChanged,
    session: updatedSession,
  };
}

/**
 * Build query params and agent call meta for a continue session operation.
 */
async function buildContinueParams({
  sessionId, session, model, systemPrompt, effectiveModel, sessionEnv,
  modelChanged, activeConversation, promptWithAttachments,
  workingDirectory, controller, agentType, agent, commitAttributionOverride,
}) {
  const canResume = activeConversation.claudeSessionId && !modelChanged && agent.supportsResume();

  const promptWithContext = await buildPromptForContinue({
    modelChanged, agent, conversationId: activeConversation.id, prompt: promptWithAttachments,
  });

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId: activeConversation.id,
    resumeSessionId: canResume ? activeConversation.claudeSessionId : null,
    agentType,
    commitAttributionOverride,
  });
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'continueSession',
    agentType,
    model,
    effortLevel: session.effortLevel,
    isResume: canResume,
    promptLength: promptWithContext.length,
  };

  return { queryParams, agentCallMeta };
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
 * Claim ownership and prepare a continuation turn.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object }}
 */
export async function prepareContinueTurn({ session, sessionId, content, workingDirectory, options, controller }) {
  const { systemPrompt = null, fileAttachments = [], model = null } = options;
  // Single atomic admission gate: a live turn — running or still shutting
  // down after a Stop — owns the session until its finalizer releases it.
  claimSessionExecution(sessionId, controller);
  try {
    const { activeConversation, promptWithAttachments } = await setupConversationAndMessage(
      sessionId, content, fileAttachments
    );

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    const agentType = session.agentType || 'claude-code';
    const agent = createAgentForSession(agentType);

    let currentSession = session;
    const modelEnv = buildContinueModelAndEnv(currentSession, sessionId, model);
    currentSession = modelEnv.session;
    if (currentSession.gitWorktree && modelEnv.commitAttributionOverride) {
      await ensureWorktreeCommitAttributionHook(currentSession.gitWorktree);
    }

    const { queryParams, agentCallMeta } = await buildContinueParams({
      sessionId, session: currentSession, model, systemPrompt,
      effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
      commitAttributionOverride: modelEnv.commitAttributionOverride,
      modelChanged: modelEnv.modelChanged, activeConversation, promptWithAttachments,
      workingDirectory, controller, agentType, agent,
    });
    return { session: currentSession, queryParams, agentCallMeta, agent };
  } catch (error) {
    // Setup failed before _executeSession took over: release this turn's
    // claim (including its conversation mapping) so the session is usable.
    cleanupSessionState(sessionId, true, controller);
    throw error;
  }
}

/**
 * Prepare the shared per-start state for runSessionCore: register the abort
 * controller, ensure the active conversation, flip the session to 'running',
 * attach any pending file attachments, and build the final prompt. Lives here
 * (not in sessionExecution.js) so the execution module stays within its
 * lifecycle size budget — this is turn preparation, which this module owns.
 *
 * @returns {{ session: Object, activeConversation: Object, promptWithAttachments: string }}
 */
export function beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller }) {
  // Single atomic admission gate, shared by the standard and tier-bound
  // initial-start paths: a live turn — running or still shutting down after
  // a Stop — owns the session until its finalizer releases it. Throws a
  // 409-coded conflict instead of replacing the live controller.
  claimSessionExecution(sessionId, controller);

  // Get the active conversation for this session (created in SessionRepository.create)
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  activeConversationIds.set(sessionId, activeConversation.id);

  // Update status to running and track the user-requested model (short format) on the session
  sessions.update(sessionId, { status: 'running', ...(model && { model, providerId: providerId ?? null }) });
  broadcastSessionStatus(sessionId, 'running');

  // Note: Initial user message is already created in SessionRepository.create()
  // Associate any pending attachments with the initial message
  const initialMessage = messages.getBySessionId(sessionId)[0];
  if (initialMessage && fileAttachments.length > 0) {
    attachments.updateMessageIdForSession(sessionId, initialMessage.id);
  }

  return {
    session: sessions.getById(sessionId),
    activeConversation,
    promptWithAttachments: buildPromptWithAttachments(prompt, fileAttachments),
  };
}

/**
 * Claim ownership and prepare an initial-run turn.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object, activeConversation: Object }}
 */
export async function prepareRunTurn({ session, sessionId, prompt, workingDirectory, options, controller }) {
  const { systemPrompt = null, fileAttachments = [], model = null } = options;
  claimSessionExecution(sessionId, controller);
  try {
    // Get the active conversation for this session (created in SessionRepository.create)
    const activeConversation = conversations.ensureActiveConversation(sessionId);
    activeConversationIds.set(sessionId, activeConversation.id);

    // Update status to running and track the user-requested model (short format) on the session
    sessions.update(sessionId, { status: 'running', ...(model && { model }) });
    let currentSession = sessions.getById(sessionId) || session;
    broadcastSessionStatus(sessionId, 'running');

    // Note: Initial user message is already created in SessionRepository.create()
    // Associate any pending attachments with the initial message
    const initialMessage = messages.getBySessionId(sessionId)[0];
    if (initialMessage && fileAttachments.length > 0) {
      attachments.updateMessageIdForSession(sessionId, initialMessage.id);
    }

    // Build prompt with attachment context
    const promptWithAttachments = buildPromptWithAttachments(prompt, fileAttachments);

    // Defense in depth: re-derive and persist the correct agent kind before creating
    // the adapter — self-heals legacy corrupted rows and any entry point that
    // bypasses the PATCH guard.
    currentSession = reconcileAgentTypeForRun(currentSession, sessionId, model);

    // Create agent via gateway (or mock agent in mock mode)
    const agentType = currentSession.agentType || 'claude-code';
    const agent = createAgentForSession(agentType);

    const { effectiveModel, sessionEnv, commitAttributionOverride } =
      await resolveInitialSessionModelEnv(currentSession, model);

    const queryParams = buildQueryParams({
      prompt: promptWithAttachments,
      workingDirectory,
      controller,
      session: currentSession,
      sessionId,
      systemPrompt,
      model: effectiveModel,
      sessionEnv,
      conversationId: activeConversation.id,
      agentType,
      commitAttributionOverride,
    });

    console.log(`[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`);
    const agentCallMeta = {
      sessionId,
      conversationId: activeConversation.id,
      callType: 'runSession',
      agentType,
      model,
      effortLevel: currentSession.effortLevel,
      promptLength: promptWithAttachments.length,
    };
    return { session: currentSession, queryParams, agentCallMeta, agent, activeConversation };
  } catch (error) {
    // Setup failed before _executeSession took over: release this turn's claim.
    cleanupSessionState(sessionId, false, controller);
    throw error;
  }
}

/**
 * Fail a turn whose preparation (ownership registration, conversation/message
 * setup, model resolution, agent construction, query-param building) threw
 * BEFORE provider dispatch — i.e. outside `_executeSession`'s own
 * error/finally boundary. Surfaces a sanitized visible error, moves the
 * session to error status, fails an owned lane obligation instead of
 * stranding it, and releases active state with controller fencing so a newer
 * turn is never erased. Always rethrows so callers still observe the failure.
 *
 * A user stop is not a permanent error: stopSession() already set the status
 * to 'stopped' and paused any open lane obligation, so this path must not
 * overwrite that state or fail the run — it only releases this turn's claim
 * and rethrows.
 *
 * @param {Object} args
 * @param {string} args.sessionId
 * @param {AbortController} args.controller - This turn's controller (fencing).
 * @param {unknown} args.error - The preparation failure.
 * @param {boolean} [args.includeConversationId=true] - Whether a conversation
 *   registration may have been created during preparation.
 */
export function handlePreparationFailure({ sessionId, controller, error, includeConversationId = true }) {
  if (isUserStopAbort(controller)) {
    cleanupSessionState(sessionId, includeConversationId, controller);
    throw error;
  }
  const sanitizedError = normalizeFinalErrorMessage(error);
  sessions.update(sessionId, { status: 'error', error: sanitizedError });
  broadcastSessionStatus(sessionId, 'error');
  closeOwnWork(sessionId, 'closed_failed', sanitizedError);
  cleanupSessionState(sessionId, includeConversationId, controller);
  throw error;
}

/**
 * Admit an initial session start through the shared atomic boundary.
 * Claims execution ownership before any start mutation (both the standard
 * and tier-bound start paths enter here), then builds the shared per-start
 * state.
 *
 * A claim conflict is a pure admission rejection — no mutation happened for
 * this start — so it rethrows untouched, without setting error state,
 * closing workflow, or cleaning up the live turn. Any other preparation
 * failure after registration fails the turn explicitly through the shared
 * preparation-failure path so the session is neither wedged nor stranded.
 *
 * @returns {{ session: Object, activeConversation: Object, promptWithAttachments: string }}
 */
export function admitSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller }) {
  try {
    return beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller });
  } catch (error) {
    if (isSessionExecutionConflictError(error)) throw error;
    handlePreparationFailure({ sessionId, controller, error, includeConversationId: false });
  }
}
