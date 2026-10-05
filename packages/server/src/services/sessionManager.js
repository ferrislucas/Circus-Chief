import { sessions, conversations, projects } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import { resolveDispatchProvider, buildSessionEnv } from './sessionProvider.js';
import { notifyOwnBindingFallback, resolveTierRefForContinueWithStaleFallback } from './sessionStaleTierFallback.js';
import { buildTierHealthContext } from './tierResolutionService.js';
import { buildLastExecutedUpdate, checkContinuationDispatchKind, createCrossKindDispatchError, deriveAgentTypeUpdate, hasDispatchPairChanged } from './sessionAgentGuard.js';
import { activeLaneRunOwnsSession, pauseForUserStop } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
import { clearedPendingSchedule } from './pendingSchedule.js';
import {
  shouldRescheduleOnError,
  _checkProactiveReschedule,
  matchesTokenLimitError,
  matchesServiceError,
} from './sessionErrors.js';
import {
  buildSystemPromptConfig,
  PLAN_MODE_PROMPT,
  getPermissionModeForSession,
  getSessionAttachmentsContext,
  buildPromptWithAttachments,
} from './sessionPrompts.js';
import { getApiBaseUrl } from './apiBaseUrl.js';
import { buildConversationContextForModelSwitch, buildConversationContextForBranch, buildConversationContextForContinuation } from './conversationContext.js';
import {
  activeConversationIds,
  cleanupSessionState,
  broadcastSessionStatus,
} from './streamEventHandler.js';
import {
  activeSessions,
  claimSessionExecution,
  markSessionStopping,
} from './sessionExecutionOwnership.js';
import { validateAndFetchContinueContext } from './sessionContinuation.js';
import { cancelPrompt } from './promptStore.js';
import { clearPendingWakeup } from './scheduleWakeupBridge.js';
import { abortForUserStop } from './sessionAbort.js';
// Import execution helpers from sessionExecution.js
import {
  createAgentForSession,
  buildQueryParams,
  _executeSession,
  runSessionCore,
  continueSessionCore,
  handlePreparationFailure,
} from './sessionExecution.js';

// Re-export prompt-related functions for backward compatibility
export { buildSystemPromptConfig, PLAN_MODE_PROMPT, getPermissionModeForSession, getSessionAttachmentsContext, buildPromptWithAttachments, getApiBaseUrl };

// Re-export error detection and rescheduling functions for backward compatibility
export { shouldRescheduleOnError, _checkProactiveReschedule, matchesTokenLimitError, matchesServiceError };

/**
 * Determine if context needs to be rebuilt for a conversation.
 * @param {Object} conversation
 * @param {boolean} modelChanged
 * @returns {{needsContext: boolean, contextType: 'modelSwitch'|'branch'|null}}
 */
function determineContextNeed(conversation, modelChanged) {
  if (modelChanged) {
    return { needsContext: true, contextType: 'modelSwitch' };
  }
  const isBranchedWithoutSession = conversation.parentConversationId && !conversation.claudeSessionId;
  if (isBranchedWithoutSession) {
    return { needsContext: true, contextType: 'branch' };
  }
  return { needsContext: false, contextType: null };
}

/**
 * Build conversation context based on context type.
 * @param {string} conversationId
 * @param {'modelSwitch'|'branch'|null} contextType
 * @returns {string}
 */
function buildContextForType(conversationId, contextType) {
  if (contextType === 'modelSwitch') {
    return buildConversationContextForModelSwitch(conversationId);
  }
  if (contextType === 'branch') {
    return buildConversationContextForBranch(conversationId);
  }
  return '';
}

/**
 * Handle template triggering if a session has a nextTemplateId configured
 * Called after Claude finishes any turn (runSession or continueSession)
 * @param {string} sessionId
 */
async function handleTemplateTriggerIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.nextTemplateId) {
    return;
  }

  // Wait for summary to be generated (templates use summary data)
  await summaryService.generateSummaryNow(sessionId);

  // Trigger the template to create a new session
  await checkAndTriggerNextTemplate(sessionId);

  // Clear the template from the session (it's been triggered)
  sessions.update(sessionId, { nextTemplateId: null });

  // Broadcast the update so UI reflects the cleared template
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId,
    session: { ...session, nextTemplateId: null }
  });
}

/**
 * Auto-send queued prompt if enabled after a model turn completes.
 * Exported for unit testing (same pattern as _checkProactiveReschedule).
 * @param {string} sessionId
 */
export async function handleAutoSendIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.autoSendPendingPrompt || !session.pendingPrompt) {
    return false;
  }

  // Clear the auto-send flag and pending prompt BEFORE sending
  // to prevent double-sends on race conditions
  const promptToSend = session.pendingPrompt;
  const modelToUse = session.pendingModel || null;
  const updatedSession = sessions.update(sessionId, {
    autoSendPendingPrompt: false,
    pendingPrompt: null,
  });

  // Broadcast the cleared state so the UI updates
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId,
    session: updatedSession,
  });

  // Re-check status — template trigger may have changed it
  const currentSession = sessions.getById(sessionId);
  if (currentSession?.status !== 'waiting') {
    return true;
  }

  // Clean up the current session's active state before calling continueSession.
  // handleAutoSendIfNeeded runs inside _executeSession's try block, so the session
  // is still in activeSessions. continueSession guards against this with
  // "Session is already processing". Cleaning up here is safe because:
  // 1. The agent stream has already ended
  // 2. cleanupSessionState just deletes Map entries (all idempotent)
  // 3. The finally block's redundant call is a harmless no-op
  cleanupSessionState(sessionId);

  // Send the queued prompt (reuses existing continueSession logic)
  try {
    const project = projects.getById(session.projectId);
    const systemPrompt = project?.systemPrompt || null;
    await continueSession(sessionId, promptToSend, session.gitWorktree || project?.workingDirectory, { systemPrompt, model: modelToUse });
  } catch (error) {
    console.error(`[AUTO-SEND] Failed to auto-send for session ${sessionId}:`, error);
  }
  return true;
}

// buildQueryParams and _executeSession moved to sessionExecution.js

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
/**
 * Callbacks shared by every execution entry point. `onUserStopSettled` fires
 * only after a user-stopped provider generator has settled, so summary
 * generation can never race output still arriving from the aborted provider.
 */
function executionCallbacks() {
  return {
    handleTemplateTriggerIfNeeded,
    handleAutoSendIfNeeded,
    onUserStopSettled: (settledSessionId) => summaryService.onSessionComplete(settledSessionId),
  };
}

export async function runSession(sessionId, prompt, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  return runSessionCore(sessionId, prompt, workingDirectory, {
    options,
    callbacks: executionCallbacks(),
  });
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
export async function continueSession(sessionId, content, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  return continueSessionCore(sessionId, content, workingDirectory, {
    options,
    callbacks: executionCallbacks(),
  });
}

/** Whether a provider turn still owns this session's execution lifecycle. */
export function isSessionActive(sessionId) {
  return activeSessions.has(sessionId);
}

/**
 * Continue a session when the user message is already stored (e.g., from branching)
 * This triggers Claude's response without creating a new user message
 * @param {string} sessionId
 * @param {string} conversationId - The conversation to continue (must have an existing user message)
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, model?: string|null }} options - Optional parameters
 */
/**
 * Validate and fetch the session, conversation, and last user message for continuing a session.
 * @returns {{ session: Object, conversation: Object, lastUserMessage: Object }}
 */
/**
 * Resolve the effective model, provider, and session env from a model override.
 * Detects model changes and updates the session record when needed.
 *
 * Defense in depth: when a new model arrives and the session has no assistant
 * messages yet (i.e. it is still effectively a draft), re-derive agent_type
 * and persist it together with model. Once the session has produced at least
 * one assistant message we MUST NOT mutate agent_type — that would corrupt
 * resume/context state across kinds.
 *
 * Tier-ref handling (Fix 2): delegates to the shared `resolveTierRefForContinue`
 * helper (also used by `sessionContinuation.buildContinueModelAndEnv`) so both
 * continuation paths share ONE tier-ref resolution/persistence contract.
 * Switching from one bound tier to a different one always resolves the NEW
 * tier live rather than reusing a snapshot captured for the old one, and an
 * explicit concrete-model override always clears any stored tier snapshot.
 *
 * @param {Object} session - Current session object
 * @param {string} sessionId - Session ID
 * @param {string|null} model - Requested model (null to keep current)
 * @returns {{ effectiveModel: string|null, sessionEnv: Object, modelChanged: boolean, session: Object }}
 */
function buildModelAndProvider(session, sessionId, model, providerId = null) {
  // Stale-binding tolerance (PRD E3/D6): a truly-stale tier binding degrades
  // (snapshot or server default, tier:failover notice) instead of throwing —
  // matching the start path's `_runTierBoundSession` behavior.
  const { effectiveModel, providerIdHint, persist } = resolveTierRefForContinueWithStaleFallback(
    sessionId, session, model, providerId
  );

  // Enforce the cross-kind policy on the exact pair about to be dispatched —
  // shared contract with `sessionContinuation.buildContinueModelAndEnv`
  // (explicit selections and catalog-fallback live resolutions alike).
  // Throws before any persistence, agent construction, or dispatch.
  const dispatchDrift = checkContinuationDispatchKind(session, sessionId, model, { effectiveModel, providerIdHint });
  if (dispatchDrift) {
    throw createCrossKindDispatchError(dispatchDrift);
  }

  const { provider } = resolveDispatchProvider(session, model, effectiveModel, providerIdHint);
  const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);

  // The dispatched concrete pair, resolved through the single dispatch rule.
  const dispatchedProviderId = provider?.id ?? providerIdHint ?? null;
  const dispatchedPair = { model: effectiveModel, providerId: dispatchedProviderId };

  // Visible fallback notice when the own binding silently moved off its
  // previously executed member (review issue 1) — shared contract with
  // `sessionContinuation.buildContinueModelAndEnv`.
  notifyOwnBindingFallback(session, model, dispatchedPair);

  // A switch is determined from the previous EXECUTED concrete (providerId,
  // modelId) pair and the newly validated candidate — shared contract with
  // `sessionContinuation.buildContinueModelAndEnv`. A provider-only switch
  // starts a fresh provider thread (no resume, replay history); distinct tier
  // bindings resolving to the same concrete pair stay on the same thread.
  const modelChanged = hasDispatchPairChanged(session, sessionId, dispatchedPair);

  let updatedSession = session;
  // Defense in depth: if this is still a draft (no assistant messages),
  // re-derive agentType so it stays in sync with the effective model. After
  // the first assistant turn this is locked. Only reconcile agentType here —
  // providerId is managed by PATCH and SessionRepository.create for non-tier
  // sessions. Suppress providerId auto-set by passing the resolved hint (or
  // the current value) as the explicit override (mirrors sessionExecution.js).
  //
  // Work Item 4: gate on `effectiveModel`, not the raw `model` override param.
  // A tier-bound draft session may have been created with a wrong initial
  // agentType (e.g. a template/lane/draft path that resolved the tier's kind
  // incorrectly before Work Item 2 closed that gap) — that must still be
  // corrected on its very first continuation, even when the caller passes no
  // explicit model override and is simply continuing on the existing
  // binding. This mirrors `sessionContinuation.buildContinueModelAndEnv`,
  // which already reconciles unconditionally on `effectiveModel`.
  const agentTypeUpdate = effectiveModel
    ? deriveAgentTypeUpdate(session, sessionId, effectiveModel, { providerId: providerIdHint ?? session.providerId })
    : {};
  // Record the durable last-executed identity alongside any other persistence
  // (see sessionContinuation.js). Written only when it differs.
  const updatePayload = { ...persist, ...agentTypeUpdate, ...buildLastExecutedUpdate(session, effectiveModel, dispatchedProviderId) };
  if (Object.keys(updatePayload).length > 0) {
    sessions.update(sessionId, updatePayload);
    updatedSession = sessions.getById(sessionId);
  }

  return { effectiveModel, sessionEnv, modelChanged, session: updatedSession };
}

/**
 * Build query params for continueSessionWithExistingMessage.
 * Handles context building (model switch / branch) and resume detection.
 * @returns {{ queryParams: Object, agentCallMeta: Object }}
 */
function buildExistingMessageQueryParams({
  sessionId, conversationId, session, systemPrompt,
  effectiveModel, sessionEnv, modelChanged, conversation,
  lastUserMessage, workingDirectory, controller, agentType, agent,
}) {
  // Determine context needs and build context
  const { needsContext, contextType } = determineContextNeed(conversation, modelChanged);
  if (needsContext) {
    console.log(`[SESSION] ${contextType === 'modelSwitch' ? 'Model changed' : 'Branched conversation'} - including context`);
  }
  let conversationContext = buildContextForType(conversationId, contextType);

  // Fallback: if no specific context was built but the adapter needs
  // conversation context (i.e. it can't resume), inject continuation history.
  if (!conversationContext && agent.needsConversationContext()) {
    conversationContext = buildConversationContextForContinuation(conversationId);
  }

  const promptWithContext = conversationContext + lastUserMessage.content;

  // Only resume if we have a session ID AND model hasn't changed AND the
  // agent supports resume.
  const canResume = conversation.claudeSessionId && !modelChanged && agent.supportsResume();

  const queryParams = buildQueryParams({
    prompt: promptWithContext,
    workingDirectory,
    controller,
    session,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId,
    resumeSessionId: canResume ? conversation.claudeSessionId : null,
  });

  // Log the RESOLVED member (effectiveModel) actually dispatched — not the
  // raw caller override, which may be a tier sentinel or null.
  const agentCallMeta = {
    sessionId,
    conversationId,
    callType: 'continueSessionWithExistingMessage',
    agentType,
    model: effectiveModel,
    effortLevel: session.effortLevel,
    isResume: canResume,
    promptLength: promptWithContext.length,
  };

  return { queryParams, agentCallMeta };
}

/**
 * Claim ownership and prepare a branch-continuation turn (the user message
 * already exists). Releases the claim if setup fails before _executeSession
 * takes over, so a setup failure can never wedge the session.
 * @returns {{ session: Object, queryParams: Object, agentCallMeta: Object, agent: Object }}
 */
function prepareBranchContinueTurn({ session, sessionId, conversationId, conversation, lastUserMessage, workingDirectory, options, controller }) {
  const { systemPrompt = null, model = null, providerId = null } = options;
  claimSessionExecution(sessionId, controller);
  try {
    // Make sure this conversation is active
    if (!conversation.isActive) {
      conversations.update(conversationId, { isActive: true });
    }
    activeConversationIds.set(sessionId, conversationId);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Resolve model/provider and detect model changes BEFORE creating the
    // agent: for a tier-bound draft, `buildModelAndProvider` may reconcile
    // and persist a new `session.agentType`. Creating the agent from the
    // stale pre-reconciliation agentType would dispatch the wrong adapter.
    const modelEnv = buildModelAndProvider(session, sessionId, model, providerId);
    const updatedSession = modelEnv.session;

    // Health attribution for tier-bound continuations (mid-conversation
    // cooldown). Built AFTER resolution so a backfilled snapshot is visible.
    // This context can report member health on an eligible failure but can
    // never authorize failover — the continuation stays pinned to this member.
    const tierContext = buildTierHealthContext(updatedSession);

    // Create agent via gateway (or mock agent in mock mode), using the
    // reconciled agentType.
    const agentType = updatedSession.agentType || 'claude-code';
    const agent = createAgentForSession(agentType);

    // Build query params and agent call meta
    const { queryParams, agentCallMeta } = buildExistingMessageQueryParams({
      sessionId, conversationId, session: updatedSession, model, systemPrompt,
      effectiveModel: modelEnv.effectiveModel, sessionEnv: modelEnv.sessionEnv,
      modelChanged: modelEnv.modelChanged, conversation,
      lastUserMessage, workingDirectory, controller, agentType, agent,
    });
    return { session: updatedSession, queryParams, agentCallMeta, agent, tierContext };
  } catch (error) {
    // Preparation failed before provider dispatch: fail the turn explicitly
    // (sanitized visible error, error status, workflow failure,
    // controller-aware cleanup) instead of wedging the session as running.
    handlePreparationFailure({ sessionId, controller, error, includeConversationId: true });
  }
}

export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, options = {}) {
  const { interactive = false } = options;
  const context = validateAndFetchContinueContext(sessionId, conversationId);
  const { session, conversation, lastUserMessage } = context;

  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }

  const controller = new AbortController();
  const prepared = prepareBranchContinueTurn({
    session, sessionId, conversationId, conversation, lastUserMessage,
    workingDirectory, options, controller,
  });

  const execution = await _executeSession({
    sessionId,
    agent: prepared.agent,
    queryParams: prepared.queryParams,
    agentCallMeta: prepared.agentCallMeta,
    controller,
    workingDirectory,
    callbacks: executionCallbacks(),
    interactive,
    errorLabel: 'Continue session with existing message error',
    tierContext: prepared.tierContext,
  });
  return execution || startedSessionExecution(sessionId);
}

/**
 * Stop a running or waiting session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  cancelPrompt(sessionId);
  const sessionData = activeSessions.get(sessionId);
  // A live execution owns the session until its own finalizer releases it —
  // even across a user Stop. The entry is marked `stopping` (never deleted
  // here) so a Continue issued while the provider is still shutting down is
  // rejected instead of starting a second provider execution against the same
  // native session.
  const hadActiveExecution = Boolean(sessionData);

  if (sessionData) {
    // Session is actively processing - abort it
    abortForUserStop(sessionData.controller);
    clearPendingWakeup(sessionId, sessionData.controller);
    markSessionStopping(sessionId, sessionData.controller);
    console.warn(
      `[sessionManager] stop requested for session ${sessionId}; provider shutdown pending (phase=stopping)`
    );
  }
  // If not in activeSessions, session may have crashed or be waiting
  // Either way, we can still update the status to stopped

  // A user-initiated stop must also cancel any pending scheduled continuation.
  // Otherwise handleScheduledContinuationIfNeeded's status-agnostic predicate
  // (deliberately unguarded, see its doc comment) will resurrect the schedule on
  // the next completed chat turn — flipping the session back to 'scheduled',
  // suppressing auto-send/template triggers for that turn, and firing a prompt
  // the user believed they had cancelled.
  sessions.update(sessionId, {
    status: 'stopped',
    ...clearedPendingSchedule,
  });
  broadcastSessionStatus(sessionId, 'stopped');

  // A user stop pauses an active structured-lane obligation rather than
  // cancelling it. Non-participating and already-closed sessions are no-ops.
  pauseForUserStop(sessionId);

  if (!hadActiveExecution) {
    // No provider turn is unwinding, so the session is truly complete now.
    summaryService.onSessionComplete(sessionId);
  }
  // Otherwise summary generation is deferred to the user-stop settlement path
  // in _executeSession, which fires only after the provider generator has
  // settled — summaries must never race output still arriving from the
  // aborted provider.
}

/**
 * Restart a completed or errored session (set back to stopped so it can receive messages)
 * @param {string} sessionId
 */
export function restartSession(sessionId) {
  // Clear any error and set status to stopped (allows sending new messages)
  sessions.update(sessionId, { status: 'stopped', error: null });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Clean up an active session before deletion
 *
 * Unlike stopSession(), this path also deletes the session row immediately
 * after, so no replacement turn can ever be admitted — admission requires
 * the row to exist. The entry is therefore dropped (rather than marked
 * `stopping`) so the still-unwinding provider turn cannot write work
 * logs/messages against the deleted row; its late events are discarded by
 * the missing-entry guard in handleStreamEvent, and its finalizer becomes a
 * harmless no-op. A bounded asynchronous deletion (await a termination grace
 * period, then answer 409/202 while shutdown is pending) remains follow-up
 * work; it needs an async delete route the current sync call chain cannot
 * provide.
 * @param {string} sessionId
 * @returns {boolean} true if session was active and cleaned up
 */
export function cleanupActiveSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (sessionData) {
    cancelPrompt(sessionId);
    sessionData.controller.abort();
    clearPendingWakeup(sessionId, sessionData.controller);
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}
