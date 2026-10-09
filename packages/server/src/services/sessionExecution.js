import { sessions } from '../database.js';
import { buildAgentEnv, createAgentForSession } from './sessionAgentConfig.js';
import { resolveProviderFromModel, resolveProviderMetadataFromModel, resolveDurableProviderId, resolveTierMemberProvider, buildSessionEnv } from './sessionProvider.js';
import { buildLastExecutedUpdate, reconcileAgentTypeForRun, sessionHasNoObservableAgentActivity } from './sessionAgentGuard.js';
import { admitSessionStart } from './sessionTurnSetup.js';
export { buildQueryParams } from './queryParamBuilder.js';
import { buildQueryParams } from './queryParamBuilder.js';
import {
  handleStreamEvent, handleTurnCompletion,
  handleSessionError, cleanupSessionState, broadcastSessionStatus,
} from './streamEventHandler.js';
import { shouldRescheduleOnError, _checkProactiveReschedule } from './sessionErrors.js';
import { isTierRef } from '@circuschief/shared';
import { assertConcreteStartModel } from './tierIdentity.js';
import { runSessionWithTierFailover, hasResolvableTierMembers } from './sessionTierFailover.js';
import { shouldRethrowForTierFailover, reportTierMemberFailureHealth } from './tierFailureHealth.js';
import { applyStaleTierFallback } from './sessionStaleTierFallback.js';
import { schedulerService } from './schedulerService.js';
import { ensureWorktreeCommitAttributionHook } from './gitService.js';
import { beginWorkflowTurn, finalizeOwnWorkCompletion, finishWorkflowTurn, closeOwnWork, markExecutionState, markHeldForLimit, pauseForUserStop, activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
import { isUserStopAbort } from './sessionAbort.js';
// W6: real cycle (kanbanService -> kanbanTriggers -> sessionManager ->
// sessionExecution), safe because this is only called at runtime inside
// _executeSession, long after the module graph is loaded (same pattern as
// session-helpers.js's database.js <-> SessionRepository cycle).
import { drainLaneEntryTrigger } from './kanbanService.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { redactUrlCredentials } from './errorSanitizer.js';
// continueSessionCore lives in sessionContinuation.js (extracted to keep this
// file under the max-lines limit); re-exported here so sessionManager.js's
// existing `from './sessionExecution.js'` import keeps working unchanged.
export { continueSessionCore } from './sessionContinuation.js';
// buildAgentEnv/createAgentForSession live in sessionAgentConfig.js
// (extracted to keep this file under the max-lines limit); re-exported here
// so sessionManager.js / sessionContinuation.js / test imports keep working
// unchanged.
export { buildAgentEnv, createAgentForSession };
// handlePreparationFailure lives in sessionTurnSetup.js (the turn-preparation
// owner); re-exported here so existing `from './sessionExecution.js'`
// importers keep working unchanged.
export { handlePreparationFailure } from './sessionTurnSetup.js';
/**
 * @param {Object} session
 * @param {string|null} model - Explicit model override (e.g. a tier member's modelId), or null to use session.model.
 * @param {string|null} [providerId] - Explicit provider for `model` (Fix 1 / Fix 4), e.g. a tier
 *   member's own providerId. When omitted and `model` is also omitted (using session.model),
 *   falls back to `session.providerId` so non-tier sessions with a known provider still
 *   disambiguate duplicate model ids correctly.
 */
// Strict startup-attempt identity (finding 5): a tier-bound dispatch names
// one atomic (providerId, modelId) member — validate the exact pair and
// derive BOTH the dispatch provider and its metadata from the same validated
// owner. A deleted/disabled provider or a removed model throws
// TierIdentityError here instead of falling back to another provider that
// owns the same model id, or to SDK defaults for identity. (A validated
// built-in Anthropic member still keeps its full provider object here; only
// its runtime environment uses SDK-default sanitization — see
// buildSessionEnv.)
function resolveTierAttemptOwner(effectiveModel, providerHint) {
  const owner = resolveTierMemberProvider(effectiveModel, providerHint);
  return { provider: owner, providerMetadata: owner };
}

// Legacy model-id lookup, scoped to concrete non-tier bindings.
function resolveLegacyStartProvider(effectiveModel, providerHint) {
  return {
    provider: resolveProviderFromModel(effectiveModel, providerHint),
    providerMetadata: resolveProviderMetadataFromModel(effectiveModel, providerHint),
  };
}

function resolveStartProvider(session, effectiveModel, providerHint) {
  // Fail closed: a tier ref must resolve to a concrete member via
  // _runTierBoundSession first — the raw `tier::` sentinel must never reach
  // provider dispatch or lastExecutedModel.
  assertConcreteStartModel(effectiveModel, providerHint ?? session?.providerId ?? null);
  if (session && isTierRef(session.model) && effectiveModel && !isTierRef(effectiveModel)) {
    return resolveTierAttemptOwner(effectiveModel, providerHint);
  }
  return resolveLegacyStartProvider(effectiveModel, providerHint);
}

export async function resolveInitialSessionModelEnv(session, model, providerId = null) {
  const effectiveModel = model || session.model;
  const providerHint = providerId ?? (model ? null : session.providerId ?? null);

  const { provider, providerMetadata } = resolveStartProvider(session, effectiveModel, providerHint);
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
    return markExecutionState(sessionId, 'scheduled');
  }
  // FR-9.8: a graceful provider limit/outage leaves the lane obligation open.
  if (heldForLimit) {
    return markHeldForLimit(sessionId);
  }
  // W6/FR-8: the server infers own-work completion from this successful,
  // non-continuing turn; finish the async remainder (start the target lane's
  // on-enter automation exactly once) if it just happened.
  if (interactive && workflowTurn?.executionStateBeforeTurn !== 'paused') {
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
async function handleTurnFailure({ sessionId, workflowTurn, tierContext, callbacks, controller, broadcastConversationStateOnError, errorLabel, error, interactive, notifyUserStopSettled }) {
  const { handleTemplateTriggerIfNeeded } = callbacks;
  // Finding 12: user cancellation settles BEFORE failover classification,
  // member-health reporting, or error rescheduling. A Stop-aborted attempt
  // whose provider rejects with an eligible capacity error must land as
  // user-paused/cancelled — never advance the tier loop, which would bypass
  // paused-work settlement and the deferred Stop-summary notification.
  if (isUserStopAbort(controller)) {
    pauseForUserStop(sessionId, { turnToken: workflowTurn?.turnToken });
    // The provider generator has settled (this runs only after execute() or
    // the stream loop rejected), so a rejection during cancellation still
    // releases the deferred summary path — exactly once per turn.
    notifyUserStopSettled?.();
    return 'failed';
  }
  if (shouldRethrowForTierFailover(sessionId, error, tierContext)) return 'rethrow';

  // Terminal tier failures stay on the normal auto-reschedule path, but the
  // failed member must still cool down so unrelated starts do not hammer it.
  // For a pinned continuation's health-only context this is the sole health
  // side effect — the attempt never advances to another member.
  reportTierMemberFailureHealth(error, tierContext);

  const rescheduled = await handleSessionError(sessionId, error, {
    controller,
    shouldRescheduleOnError: (session, err, sid) =>
      shouldRescheduleOnError(session, err, sid, tierContext),
    schedulerService,
    broadcastConversationState: broadcastConversationStateOnError,
    errorLabel,
    handleTemplateTriggerIfNeeded,
    interactive,
  });
  if (rescheduled) {
    // FR-9.1/FR-9.5: a transient error with an automatic retry/reschedule
    // keeps the session (and its lane run) open — only the execution_state
    // dimension moves, own_work_state is untouched.
    markExecutionState(sessionId, 'retrying');
    return 'rescheduled'; // Don't throw - session was rescheduled
  }
  // FR-9.2/FR-9.4: user stops settle at the top of this function (finding 12
  // — before failover classification), so only genuine permanent errors reach
  // here and land as 'closed_failed'. Terminal either way — never success —
  // and reconcileLaneRun() below fails/cancels the lane run so a structured
  // card never advances past this session.
  closeOwnWork(sessionId, 'closed_failed', error.message, { turnToken: workflowTurn?.turnToken });
  return 'failed';
}

/**
 * Settle an aborted turn at a stream boundary. A user stop pauses the lane
 * obligation and notifies (so summaries may read settled output); any other
 * abort rethrows the abort reason. Returns true when the caller must return
 * immediately (the turn ended by abort), false to continue.
 */
function settleAbortedTurn({ sessionId, controller, workflowTurn, notifyUserStopSettled }) {
  if (!controller.signal.aborted) return false;
  if (isUserStopAbort(controller)) {
    pauseForUserStop(sessionId, { turnToken: workflowTurn?.turnToken });
    notifyUserStopSettled();
    return true;
  }
  throw controller.signal.reason || new Error('Session execution was aborted');
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
 * @param {Function} [options.callbacks.onUserStopSettled] - Fired after a user-stopped
 *   provider generator has settled (confirmed provider exit), e.g. to trigger
 *   summary generation without racing still-arriving output.
 * @param {boolean} [options.broadcastConversationStateOnError] - Whether to broadcast conversation state on error
 * @param {string} [options.errorLabel] - Label for error logging
 * @param {Object|null} [options.tierContext] - Tier failover context passed to shouldRescheduleOnError
 */
// The orchestration branches mirror the distinct durable workflow outcomes.
// eslint-disable-next-line complexity
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
  const { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded, onUserStopSettled } = callbacks;
  // Idempotent: the settled-stop signal must fire exactly once per turn,
  // whether the provider exited normally (settleAbortedTurn) or rejected
  // during cancellation (handleTurnFailure's user-stop branch). Callback
  // errors stay isolated so a failing summary hook cannot fail the turn.
  let userStopSettledNotified = false;
  const notifyUserStopSettled = () => {
    if (userStopSettledNotified) return;
    userStopSettledNotified = true;
    // The provider generator has settled at every call site below (the
    // for-await loop only exits once the adapter iterator has finished, and a
    // `break` awaits its return()), so this is confirmed provider exit — the
    // only moment a summary may safely read the turn's output.
    try { onUserStopSettled?.(sessionId); } catch (error) {
      console.error(`[SessionManager] onUserStopSettled failed for session ${sessionId}:`, error?.message || error);
    }
  };
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
    const { observableActivityBeforeTerminalError } = await executeProviderStream({
      sessionId, agent, providerQueryParams, agentCallMeta, controller, tierContext,
    });
    if (settleAbortedTurn({ sessionId, controller, workflowTurn, notifyUserStopSettled })) return;
    // Handle post-turn completion (work log association, status transition, summary, etc.)
    const { wasRescheduled, heldForLimit, terminalError } = await handleTurnCompletion(
      sessionId,
      workingDirectory,
      { handleTemplateTriggerIfNeeded, checkProactiveReschedule: _checkProactiveReschedule, handleAutoSendIfNeeded },
      { controller },
    );
  // A stop invalidates the completion pipeline; stale work must not close the paused obligation.
    if (settleAbortedTurn({ sessionId, controller, workflowTurn, notifyUserStopSettled })) return;
    // Some providers report terminal failures as a final stream event and then
    // close their generator normally. Route that outcome through the same retry
    // policy as a rejected execute() call; otherwise the normal completion path
    // would incorrectly close the workflow obligation as successful.
    if (terminalError) return handleTerminalStreamError({
      sessionId, terminalError, controller, tierContext, broadcastConversationStateOnError,
      errorLabel, handleTemplateTriggerIfNeeded, workflowTurn, observableActivityBeforeTerminalError, interactive,
    });
    await completeSuccessfulTurn({ sessionId, interactive, workflowTurn, wasRescheduled, heldForLimit });
  } catch (error) {
    const outcome = await handleTurnFailure({
      sessionId, workflowTurn, tierContext, callbacks, controller,
      broadcastConversationStateOnError, errorLabel, error, interactive,
      notifyUserStopSettled,
    });
    if (outcome === 'rethrow' || outcome === 'failed') throw error;
    if (outcome === 'rescheduled') return { started: true, outcome };
  } finally {
    // Sole ownership-release point: runs only after the provider generator
    // above has settled, and only clears this turn's own entry (controller
    // fence). A replacement turn can never be admitted before this runs.
    cleanupSessionState(sessionId, cleanupConversationId, controller);
  }
}

/**
 * Consume one provider stream and capture whether activity preceded a streamed
 * terminal error. The capture must happen before the result handler persists
 * its own visible error message, which is not provider activity to replay.
 */
async function executeProviderStream({ sessionId, agent, providerQueryParams, agentCallMeta, controller, tierContext }) {
  let observableActivityBeforeTerminalError = false;
  for await (const event of agent.execute(providerQueryParams, agentCallMeta)) {
    if (controller.signal.aborted) break;
    if (event.type === 'result' && event.subtype === 'error') {
      observableActivityBeforeTerminalError = !sessionHasNoObservableAgentActivity(sessionId);
    }
    await handleStreamEvent(sessionId, event, {
      controller,
      // Thread the turn's session env so tool-input/tool-output scrubbing
      // can redact provider-supplied secret values.
      env: providerQueryParams?.options?.env,
      // `result:error` is a normal provider event, not an iterator rejection.
      // Let the stream layer rethrow it only when this attempt can genuinely
      // fail over, before it creates terminal error state/messages.
      shouldThrowOnResultError: (error) => shouldRethrowForTierFailover(sessionId, error, tierContext),
    });
  }
  return { observableActivityBeforeTerminalError };
}

async function handleTerminalStreamError({
  sessionId, terminalError, controller, tierContext, broadcastConversationStateOnError,
  errorLabel, handleTemplateTriggerIfNeeded, workflowTurn, observableActivityBeforeTerminalError, interactive,
}) {
  // A streamed terminal failure still attributes health to the exact member
  // that served the attempt — including a pinned continuation's health-only
  // context and a start-loop member whose failure merely reschedules the
  // session. (Failover-authorized attempts with a healthy successor never
  // reach this function: the stream layer rethrows them so the failover loop
  // can classify and advance.)
  // Finding 12: a user stop is not a member failure — never cool a member
  // the user cancelled.
  if (!isUserStopAbort(controller)) {
    reportTierMemberFailureHealth(terminalError, tierContext);
  }

  const rescheduled = await handleSessionError(sessionId, terminalError, {
    controller,
    shouldRescheduleOnError: (session, error, sid) =>
      shouldRescheduleOnError(session, error, sid, tierContext),
    schedulerService,
    broadcastConversationState: broadcastConversationStateOnError,
    errorLabel,
    handleTemplateTriggerIfNeeded,
    errorAlreadyRecorded: true,
    interactive,
  });
  if (rescheduled) {
    markExecutionState(sessionId, 'retrying');
    return { started: true, outcome: 'rescheduled' };
  }
  closeOwnWork(sessionId, 'closed_failed', terminalError.message, {
    turnToken: workflowTurn?.turnToken,
  });
  return { started: true, outcome: 'failed', error: terminalError, observableActivityBeforeTerminalError };
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

  // Atomic admission through the shared start boundary (claim before any
  // mutation; claim conflicts rethrow untouched, other preparation failures
  // fail the turn explicitly). Both the standard and tier-bound paths enter
  // through this call.
  const { session, activeConversation, promptWithAttachments } =
    admitSessionStart(sessionId, prompt, { model, providerId, fileAttachments, controller });

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
    //
    // A user stop is not a permanent error: stopSession() already set the
    // status to 'stopped' and paused any open lane obligation, so this catch
    // must not overwrite that state or fail the run. Keep parity with
    // handleTurnFailure — only real failures terminally close own work.
    if (!isUserStopAbort(controller)) {
      const sanitizedError = normalizeFinalErrorMessage(error);
      sessions.update(sessionId, { status: 'error', error: sanitizedError });
      broadcastSessionStatus(sessionId, 'error');
      closeOwnWork(sessionId, 'closed_failed', sanitizedError);
    }
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

  // Record the durable last-executed identity for the dispatched concrete
  // pair (see sessionContinuation.js). Written only when it differs, so
  // restarts on an unchanged binding perform no extra write. Uses the shared
  // durable identity rule so an official Anthropic dispatch records its real
  // provider instead of the runtime null-provider SDK convention.
  const startProviderId = effectiveModel
    ? resolveDurableProviderId(effectiveModel, providerId ?? reconciledSession.providerId)
    : null;
  const lastExecutedUpdate = buildLastExecutedUpdate(reconciledSession, effectiveModel, startProviderId);
  if (Object.keys(lastExecutedUpdate).length > 0) {
    sessions.update(sessionId, lastExecutedUpdate);
  }

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
  console.log(`[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${redactUrlCredentials(queryParams.options?.env?.ANTHROPIC_BASE_URL) || '[not set]'}`);

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
