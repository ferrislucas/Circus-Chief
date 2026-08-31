import { sessions, messages, attachments, conversations } from '../database.js';
import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { resolveProviderFromModel, resolveProviderMetadataFromModel, buildSessionEnv } from './sessionProvider.js';
import { reconcileAgentTypeForRun } from './sessionAgentGuard.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';
import { isE2ESpawnCaptureEnabled } from './e2eSpawnCapture.js';
export { buildQueryParams } from './queryParamBuilder.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { buildPromptWithAttachments } from './sessionPrompts.js';
import {
  activeSessions, activeConversationIds, handleStreamEvent, handleTurnCompletion,
  handleSessionError, cleanupSessionState, broadcastSessionStatus,
} from './streamEventHandler.js';
import { shouldRescheduleOnError, isTierFailoverEligibleError, matchesStartFailoverEligibleError, _checkProactiveReschedule } from './sessionErrors.js';
import { markUnhealthy } from './tierResolutionService.js';
import { isTierRef } from '@circuschief/shared';
import { runSessionWithTierFailover, hasResolvableTierMembers, applyStaleTierFallback } from './sessionTierFailover.js';
import { schedulerService } from './schedulerService.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { beginWorkflowTurn, discardDeferredCardMoveForTurn, finalizeOwnWorkCompletion, finishWorkflowTurn, closeOwnWork, markExecutionState, markHeldForLimit, activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
// W6: real cycle (kanbanService -> kanbanTriggers -> sessionManager ->
// sessionExecution), safe because this is only called at runtime inside
// _executeSession, long after the module graph is loaded (same pattern as
// session-helpers.js's database.js <-> SessionRepository cycle).
import { drainLaneEntryTrigger } from './kanbanService.js';
// continueSessionCore lives in sessionContinuation.js (extracted to keep this
// file under the max-lines limit); re-exported here so sessionManager.js's
// existing `from './sessionExecution.js'` import keeps working unchanged.
export { continueSessionCore } from './sessionContinuation.js';

/**
 * Build the adapter-specific default config object for
 * {@link createAgentForSession}. Callers may pass an explicit `config` to
 * override these defaults.
 * @param {string} agentType
 * @returns {Object}
 */
function buildAgentConfig(agentType) {
  if (agentType === 'codex') {
    return { spawnCodexProcess: createCodexSpawner() };
  }
  if (agentType === 'gemini') {
    return { spawnGeminiProcess: createGeminiSpawner() };
  }
  return {};
}

/**
 * @param {Object} sessionEnv
 * @param {string|null} commitAttributionOverride
 * @param {{ providerId?: string|null, sessionId?: string|null }} [e2eMeta] - Only
 *   applied when {@link isE2ESpawnCaptureEnabled} is true; threads the
 *   resolved providerId/sessionId through to the spawned CLI's `env` purely
 *   so the E2E spawn-capture seam (e2eSpawnCapture.js) can recover which
 *   (provider, model, session) a captured/scripted spawn attempt belongs to.
 *   Never read outside of E2E spawn-capture mode.
 */
export function buildAgentEnv(sessionEnv, commitAttributionOverride, e2eMeta = null) {
  const env = { ...(sessionEnv || {}) };
  if (commitAttributionOverride) {
    env.CIRCUSCHIEF_COMMIT_ATTRIBUTION = commitAttributionOverride;
  } else {
    delete env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  if (e2eMeta && isE2ESpawnCaptureEnabled()) {
    if (e2eMeta.providerId) env.CIRCUSCHIEF_E2E_PROVIDER_ID = e2eMeta.providerId;
    if (e2eMeta.sessionId) env.CIRCUSCHIEF_E2E_SESSION_ID = e2eMeta.sessionId;
  }
  return env;
}

/**
 * @param {Object} session
 * @param {string|null} model - Explicit model override (e.g. a tier member's modelId), or null to use session.model.
 * @param {string|null} [providerId] - Explicit provider for `model` (Fix 1 / Fix 4), e.g. a tier
 *   member's own providerId. When omitted and `model` is also omitted (using session.model),
 *   falls back to `session.providerId` so non-tier sessions with a known provider still
 *   disambiguate duplicate model ids correctly.
 */
export async function resolveInitialSessionModelEnv(session, model, providerId = null) {
  const effectiveModel = model || session.model;
  const providerHint = providerId ?? (model ? null : session.providerId ?? null);
  const provider = resolveProviderFromModel(effectiveModel, providerHint);
  const providerMetadata = resolveProviderMetadataFromModel(effectiveModel, providerHint);
  const commitAttributionOverride = providerMetadata?.commitAttributionOverride ?? null;

  if (session.gitWorktree && commitAttributionOverride) {
    await ensureWorktreeCommitAttributionHook(session.gitWorktree);
  }

  const baseSessionEnv = buildSessionEnv(provider, session.thinkingEnabled, session.effortLevel);
  return {
    effectiveModel,
    sessionEnv: buildAgentEnv(baseSessionEnv, commitAttributionOverride, {
      providerId: provider?.id ?? null,
      sessionId: session.id,
    }),
    commitAttributionOverride,
  };
}

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * If `config` is empty, the adapter-specific default config is applied
 * (e.g. codex receives a fresh `spawnCodexProcess` spawner). Explicit
 * `config` keys win over defaults.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code', 'codex')
 * @param {Object} [config] - Optional adapter config forwarded to the gateway.
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }}
 */
export function createAgentForSession(agentType = 'claude-code', config = {}) {
  const mergedConfig = { ...buildAgentConfig(agentType), ...config };
  const baseAgent = agentGateway.createAgent(agentType, mergedConfig);

  // Wrap with VCR adapter if in VCR mode
  const agent = process.env.VCR_MODE && !isE2ESpawnCaptureEnabled()
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
}

/**
 * Post-turn workflow bookkeeping for a turn that completed without throwing.
 *
 * Each early return leaves the session's own-work obligation open; only the
 * final branch infers own-work completion and drains the target lane's
 * on-enter automation.
 *
 * Distinct from workflowSessionService.finishWorkflowTurn (which clears the
 * running execution state for a specific turn token); this helper owns the
 * full success-path branching on top of it.
 *
 * @param {Object} opts
 * @param {string} opts.sessionId
 * @param {boolean} opts.interactive
 * @param {Object|null} opts.workflowTurn - Snapshot from beginWorkflowTurn()
 * @param {boolean} opts.wasRescheduled
 * @param {boolean} opts.heldForLimit
 */
async function completeSuccessfulTurn({ sessionId, interactive, workflowTurn, wasRescheduled, heldForLimit }) {
  const turnToken = workflowTurn?.turnToken;
  // FR-4/FR-5: a self-scheduled continuation is an open obligation, not success.
  if (wasRescheduled) {
    discardDeferredCardMoveForTurn(sessionId, turnToken, 'turn_rescheduled');
    return markExecutionState(sessionId, 'scheduled');
  }
  // FR-9.8: a graceful provider limit/outage leaves the lane obligation open.
  if (heldForLimit) {
    discardDeferredCardMoveForTurn(sessionId, turnToken, 'provider_held');
    return markHeldForLimit(sessionId);
  }
  // W6/FR-8: the server infers own-work completion from this successful,
  // non-continuing turn; finish the async remainder (start the target lane's
  // on-enter automation exactly once) if it just happened.
  if (interactive && workflowTurn?.executionStateBeforeTurn !== 'paused') {
    discardDeferredCardMoveForTurn(sessionId, turnToken, 'interactive_turn_does_not_complete_work');
    finishWorkflowTurn(sessionId, turnToken);
    return;
  }
  const reconciled = finalizeOwnWorkCompletion(sessionId, { turnToken });
  // The successor run can be committed by finalization, but it is never
  // dispatched until this provider has genuinely returned and this turn has
  // relinquished its running lifecycle state.
  finishWorkflowTurn(sessionId, turnToken);
  if (reconciled?.pendingTargetLaneTrigger) {
    await drainLaneEntryTrigger(reconciled.pendingTargetLaneTrigger.laneEntryEventId);
  }
}

/**
 * Tier failover: when this attempt is part of a tier failover loop AND the
 * error is failover-eligible, the normal error-handling side effects
 * (status=error, visible error message, SESSION_ERROR broadcast, summary
 * generation) must be skipped — they would be misleading since we're about to
 * transparently retry on the next tier member. The caller rethrows instead so
 * the failover loop in sessionTierFailover.js can catch it and advance.
 *
 * @param {string} sessionId
 * @param {Error} error
 * @param {Object|null} tierContext
 * @returns {boolean} true when the error should be rethrown untouched
 */
function shouldRethrowForTierFailover(sessionId, error, tierContext) {
  if (!tierContext) return false;
  const currentSession = sessions.getById(sessionId);
  return Boolean(currentSession && isTierFailoverEligibleError(currentSession, error, sessionId, tierContext));
}

/**
 * Inject the durable workflow turn token into the agent's environment so the
 * agent's card-move API can attribute a deferred move to this exact execution
 * (not merely the reusable session row). Non-workflow turns pass through
 * unchanged.
 * @param {Object} queryParams - Query parameters for agent.execute()
 * @param {Object|null} workflowTurn - Snapshot from beginWorkflowTurn()
 * @returns {Object} queryParams with the token env var set when applicable
 */
function withWorkflowTurnToken(queryParams, workflowTurn) {
  const turnToken = workflowTurn?.turnToken;
  if (!turnToken || !queryParams?.options?.env) return queryParams;
  return {
    ...queryParams,
    options: {
      ...queryParams.options,
      env: {
        ...queryParams.options.env,
        CIRCUSCHIEF_WORKFLOW_TURN_TOKEN: turnToken,
      },
    },
  };
}

/**
 * Error-path bookkeeping for a turn that threw. Returns true when the caller
 * must rethrow the error untouched (tier failover) or the session was merely
 * rescheduled; returns false after recording a terminal failure so the caller
 * can stop silently.
 *
 * @param {Object} opts
 * @param {string} opts.sessionId
 * @param {Object|null} opts.workflowTurn - Snapshot from beginWorkflowTurn()
 * @param {Object|null} opts.tierContext
 * @param {Object} opts.callbacks
 * @param {AbortController} opts.controller
 * @param {boolean} opts.broadcastConversationStateOnError
 * @param {string} opts.errorLabel
 * @param {Error} opts.error
 * @returns {Promise<'rethrow'|'rescheduled'|'failed'>}
 */
async function handleTurnFailure({ sessionId, workflowTurn, tierContext, callbacks, controller, broadcastConversationStateOnError, errorLabel, error }) {
  const { handleTemplateTriggerIfNeeded } = callbacks;
  if (shouldRethrowForTierFailover(sessionId, error, tierContext)) return 'rethrow';

  // Terminal tier failures stay on the normal auto-reschedule path, but the
  // failed member must still cool down so unrelated starts do not hammer it.
  if (tierContext && matchesStartFailoverEligibleError(error)) {
    markUnhealthy(tierContext.currentMemberProviderId, tierContext.currentMemberId);
  }

  const rescheduled = await handleSessionError(sessionId, error, {
    controller,
    shouldRescheduleOnError: (session, err, sid) =>
      shouldRescheduleOnError(session, err, sid, tierContext),
    schedulerService,
    broadcastConversationState: broadcastConversationStateOnError,
    errorLabel,
    handleTemplateTriggerIfNeeded,
  });
  if (rescheduled) {
    // FR-9.1/FR-9.5: a transient error with an automatic retry/reschedule
    // keeps the session (and its lane run) open — only the execution_state
    // dimension moves, own_work_state is untouched.
    discardDeferredCardMoveForTurn(sessionId, workflowTurn?.turnToken, 'turn_retrying');
    markExecutionState(sessionId, 'retrying');
    return 'rescheduled'; // Don't throw - session was rescheduled
  }
  // FR-9.2/FR-9.4: distinguish a user-initiated stop (must land as
  // 'cancelled', never a failure) from a genuine permanent error (must land
  // as 'closed_failed'). Both are terminal — neither may be interpreted as
  // success, and reconcileLaneRun() below fails/cancels the lane run so a
  // structured card never advances past this session.
  discardDeferredCardMoveForTurn(sessionId, workflowTurn?.turnToken, controller.signal.aborted ? 'turn_cancelled' : 'turn_failed');
  closeOwnWork(sessionId, controller.signal.aborted ? 'cancelled' : 'closed_failed', error.message,
    { turnToken: workflowTurn?.turnToken });
  return 'failed';
}

/**
 * Execute the agent stream loop and handle post-turn completion, errors, and cleanup.
 * This is the shared core of runSession, continueSession, and continueSessionWithExistingMessage.
 * @param {Object} options
 * @param {string} options.sessionId - Session ID
 * @param {Object} options.agent - Agent instance with execute() method
 * @param {Object} options.queryParams - Query parameters for agent.execute()
 * @param {Object} options.agentCallMeta - Logging metadata for agent call tracking
 * @param {AbortController} options.controller - Abort controller
 * @param {string} options.workingDirectory - Session working directory
 * @param {Object} options.callbacks - Callback functions passed from sessionManager
 * @param {Function} options.callbacks.handleTemplateTriggerIfNeeded - Template trigger handler
 * @param {Function} options.callbacks.handleAutoSendIfNeeded - Auto-send handler
 * @param {boolean} [options.broadcastConversationStateOnError] - Whether to broadcast conversation state on error
 * @param {string} [options.errorLabel] - Label for error logging
 * @param {Object|null} [options.tierContext] - Tier failover context passed to shouldRescheduleOnError
 */
export async function _executeSession({
  sessionId,
  agent,
  queryParams,
  agentCallMeta,
  controller,
  workingDirectory,
  callbacks,
  broadcastConversationStateOnError = false,
  cleanupConversationId = false, interactive = false,
  errorLabel = 'Session error',
  tierContext = null,
}) {
  const { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded } = callbacks;
  const workflowTurn = beginWorkflowTurn(sessionId);
  // Last ownership fence before the irreversible provider call.
  if (!interactive && !workflowTurn && !activeLaneRunOwnsSession(sessionId)) {
    cleanupSessionState(sessionId, cleanupConversationId, controller);
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }
  // The provider is about to start. The token is generated durably by
  // beginWorkflowTurn and lets the agent's card-move API identify this exact
  // execution, not merely this reusable session row.
  const providerQueryParams = withWorkflowTurnToken(queryParams, workflowTurn);
  try {
    // Run the query with the agent (SDK via gateway, or mock)
    for await (const event of agent.execute(providerQueryParams, agentCallMeta)) {
      if (controller.signal.aborted) break;
      await handleStreamEvent(sessionId, event, {
        controller,
        // `result:error` is a normal provider event, not an iterator rejection.
        // Let the stream layer rethrow it only when this attempt can genuinely
        // fail over, before it creates terminal error state/messages.
        shouldThrowOnResultError: (error) => shouldRethrowForTierFailover(sessionId, error, tierContext),
      });
    }
    if (controller.signal.aborted) {
      discardDeferredCardMoveForTurn(sessionId, workflowTurn?.turnToken, 'turn_cancelled');
      closeOwnWork(sessionId, 'cancelled', 'Provider turn cancelled', { turnToken: workflowTurn?.turnToken });
      return;
    }
    // Handle post-turn completion (work log association, status transition, summary, etc.)
    const { wasRescheduled, heldForLimit, terminalError } = await handleTurnCompletion(
      sessionId,
      workingDirectory,
      { handleTemplateTriggerIfNeeded, checkProactiveReschedule: _checkProactiveReschedule, handleAutoSendIfNeeded },
      { controller },
    );
    // Some providers report terminal failures as a final stream event and then
    // close their generator normally. Route that outcome through the same retry
    // policy as a rejected execute() call; otherwise the normal completion path
    // would incorrectly close the workflow obligation as successful.
    if (terminalError) return handleTerminalStreamError({
      sessionId, terminalError, controller, tierContext, broadcastConversationStateOnError,
      errorLabel, handleTemplateTriggerIfNeeded, workflowTurn,
    });
    await completeSuccessfulTurn({ sessionId, interactive, workflowTurn, wasRescheduled, heldForLimit });
  } catch (error) {
    const outcome = await handleTurnFailure({
      sessionId, workflowTurn, tierContext, callbacks, controller,
      broadcastConversationStateOnError, errorLabel, error,
    });
    if (outcome === 'rethrow' || outcome === 'failed') throw error;
  } finally {
    cleanupSessionState(sessionId, cleanupConversationId, controller);
  }
}

async function handleTerminalStreamError({
  sessionId, terminalError, controller, tierContext, broadcastConversationStateOnError,
  errorLabel, handleTemplateTriggerIfNeeded, workflowTurn,
}) {
  const rescheduled = await handleSessionError(sessionId, terminalError, {
    controller,
    shouldRescheduleOnError: (session, error, sid) =>
      shouldRescheduleOnError(session, error, sid, tierContext),
    schedulerService,
    broadcastConversationState: broadcastConversationStateOnError,
    errorLabel,
    handleTemplateTriggerIfNeeded,
    errorAlreadyRecorded: true,
  });
  discardDeferredCardMoveForTurn(
    sessionId,
    workflowTurn?.turnToken,
    rescheduled ? 'turn_retrying' : 'turn_failed',
  );
  if (rescheduled) return markExecutionState(sessionId, 'retrying');
  return closeOwnWork(sessionId, 'closed_failed', terminalError.message, {
    turnToken: workflowTurn?.turnToken,
  });
}
/**
 * Prepare the shared per-start state for {@link runSessionCore}: register the
 * abort controller, ensure the active conversation, flip the session to
 * 'running', attach any pending file attachments, and build the final prompt.
 *
 * Extracted from runSessionCore so the entry point stays within the
 * complexity/statement budget now that it also has to branch across the
 * tier-failover and standard start paths.
 *
 * @returns {{ session: Object, activeConversation: Object, promptWithAttachments: string }}
 */
function beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller }) {
  activeSessions.set(sessionId, { controller, turnStartedAt: Date.now(), lastEventAt: Date.now() });

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
 * Tier-bound start path: run the tier's members in order via the failover loop,
 * or — when the ref no longer resolves to any member — degrade to a concrete
 * fallback model on the standard path.
 *
 * @returns {Promise<Object|undefined>} A start-result when the start was
 *   rejected before dispatch, otherwise undefined.
 */
async function _runTierBoundSession(sessionId, promptWithAttachments, workingDirectory, ctx) {
  const { session, tierRef, systemPrompt, activeConversation, controller, callbacks } = ctx;
  if (hasResolvableTierMembers(tierRef)) {
    return runSessionWithTierFailover(sessionId, promptWithAttachments, workingDirectory, {
      systemPrompt,
      activeConversation,
      controller,
      callbacks,
      tierRef,
    });
  }

  // Fix 6: the tier ref no longer resolves to any member (deleted / emptied /
  // every member's provider or model was removed) — this is a stale binding,
  // not a live "all members failed" exhaustion (that case is handled inside
  // runSessionWithTierFailover and correctly falls through to normal error
  // handling instead). Degrade to a concrete fallback so a new or scheduled
  // session doesn't fail outright on a binding the user can no longer fix
  // from within this session.
  const fallback = applyStaleTierFallback(sessionId, session, tierRef);
  return _runStandardSession(sessionId, promptWithAttachments, workingDirectory, {
    session: fallback.session,
    model: fallback.model,
    providerId: fallback.session.providerId,
    systemPrompt,
    activeConversation,
    controller,
    callbacks,
  });
}

/**
 * Run a Claude session (initial session start)
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 * @returns {Promise<Object>} Structured start result (see sessionStartResult.js)
 */
export async function runSessionCore(sessionId, prompt, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { systemPrompt = null, fileAttachments = [], model = null, providerId = null, interactive = false,
    abortController = null } = options;
  // Get session for settings
  const existing = sessions.getById(sessionId);
  if (!existing) throw new Error('Session not found');
  if (!interactive && existing.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }
  const controller = abortController || new AbortController();
  if (controller.signal.aborted) return rejectedSessionExecution(sessionId, 'dispatch_aborted');

  const { session, activeConversation, promptWithAttachments } =
    beginSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller });

  const startCtx = { session, systemPrompt, activeConversation, controller, callbacks };

  // ── Tier failover path ────────────────────────────────────────────────────
  const effectiveModelField = model || session.model;
  let execution;
  try {
    execution = isTierRef(effectiveModelField)
      ? await _runTierBoundSession(sessionId, promptWithAttachments, workingDirectory, {
        ...startCtx, tierRef: effectiveModelField,
      })
    // ── Standard (non-tier) path ────────────────────────────────────────────
      : await _runStandardSession(sessionId, promptWithAttachments, workingDirectory, {
        ...startCtx, model, providerId,
      });
  } catch (error) {
    // Resolution and tier selection can fail before _executeSession establishes
    // its own error/finally boundary. Do not leave the session registered as
    // active or a participating lane run waiting forever for open work.
    sessions.update(sessionId, { status: 'error', error: error.message });
    broadcastSessionStatus(sessionId, 'error');
    closeOwnWork(sessionId, 'closed_failed', error.message);
    throw error;
  } finally {
    cleanupSessionState(sessionId, false, controller);
  }

  // A start path only returns a result when the dispatch was rejected before
  // reaching the provider (e.g. lane-run ownership lost); anything else means
  // the provider handoff was accepted.
  return execution || startedSessionExecution(sessionId);
}

/**
 * Standard (non-tier) session start path: reconcile the agent kind, resolve the
 * model/provider environment, and execute the agent stream.
 * @param {string} sessionId
 * @param {string} promptWithAttachments
 * @param {string} workingDirectory
 * @param {Object} ctx
 */
async function _runStandardSession(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { session, model, providerId, systemPrompt, activeConversation, controller, callbacks }
) {
  // Defense in depth: re-derive and persist the correct agent kind before creating
  // the adapter — self-heals legacy corrupted rows and any entry point that
  // bypasses the PATCH guard.
  const reconciledSession = reconcileAgentTypeForRun(session, sessionId, model, providerId ?? session.providerId);

  // Create agent via gateway (or mock agent in mock mode)
  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, model, providerId ?? session.providerId);

  const queryParams = buildQueryParams({
    prompt: promptWithAttachments,
    workingDirectory,
    controller,
    session: reconciledSession,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId: activeConversation.id,
    agentType,
    commitAttributionOverride,
  });

  // Log query params for debugging third-party provider issues
  console.log(`[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`);

  // Logging metadata for agent call tracking
  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'runSession',
    agentType,
    model,
    effortLevel: reconciledSession.effortLevel,
    promptLength: promptWithAttachments.length,
  };

  return _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    callbacks,
    errorLabel: 'Session error',
  });
}
