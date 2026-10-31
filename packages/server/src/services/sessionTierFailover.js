/* eslint-disable max-lines -- this loop and its start-path lifecycle share one failover boundary. */
import { sessions, modelTiers } from '../database.js';
import {
  reconcileAgentTypeForRun,
  sessionHasNoAssistantMessages,
  sessionHasNoObservableAgentActivity,
} from './sessionAgentGuard.js';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import {
  getTierMembersResolved,
  findNextHealthyTierMemberInSnapshot,
  isUnhealthy,
  tierMemberKey,
} from './tierResolutionService.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions } from './sessionExecutionOwnership.js';
import {
  createAgentForSession,
  resolveInitialSessionModelEnv,
  _executeSession,
  _runStandardSession,
} from './sessionExecution.js';
import { applyStaleTierFallback } from './sessionStaleTierFallback.js';
import { broadcastSessionStatus, cleanupSessionState } from './streamEventHandler.js';
import { closeOwnWork } from './workflowSessionService.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';
import { redactUrlCredentials } from './errorSanitizer.js';
import { isUserStopAbort } from './sessionAbort.js';
import { createTierCooldownUnavailableError } from './tierCooldownUnavailableError.js';
import {
  clearTierAttemptMember,
  pinSessionToTierMember,
  registerTierAttemptMember,
} from './tierMemberPin.js';
import {
  ModelTierExhaustedError,
  classifyAttemptFailure,
  emitTierFailoverEvent,
  throwTerminalStreamFailure,
} from './tierAttemptOutcome.js';

export { sanitizeTierFailureReason } from './tierFailureReason.js';
export { ModelTierExhaustedError } from './tierAttemptOutcome.js';

class TierMemberUnavailableAtDispatchError extends Error {
  constructor() {
    super('Tier member became unavailable before provider dispatch');
    this.code = 'TIER_MEMBER_UNAVAILABLE_AT_DISPATCH';
  }
}

/**
 * Execute a single attempt with a concrete (model, providerId) pair.
 * Extracted so the tier failover loop can call it with different members.
 */
async function attemptRunWithModel(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierContext,
    beforeProviderExecute = null, onProviderDispatchInitiated = null }
) {
  // Re-derive session from DB in case a previous attempt updated it
  const currentSession = sessions.getById(sessionId);

  // Fix 4: thread the exact member providerId through — never re-derive the
  // agent type / env from modelId alone, which would be ambiguous whenever
  // two tier members share the same modelId across different providers.
  const memberModelId = tierContext ? tierContext.currentMemberId : null;
  const memberProviderId = tierContext ? tierContext.currentMemberProviderId : null;

  // Reconcile agent type for this concrete model (supports cross-provider switches)
  const reconciledSession = reconcileAgentTypeForRun(
    currentSession,
    sessionId,
    memberModelId,
    memberProviderId
  );

  // Allowance observation and fixture injection use the exact attempted provider,
  // before durable activity pins that identity on the tier-bound session.
  const dispatchSession = { ...reconciledSession, providerId: memberProviderId };
  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType, {}, dispatchSession);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, memberModelId, memberProviderId);

  const queryParams = buildQueryParams({
    prompt: promptWithAttachments,
    workingDirectory,
    controller,
    session: dispatchSession,
    sessionId,
    systemPrompt,
    model: effectiveModel,
    sessionEnv,
    conversationId: activeConversation.id,
    agentType,
    commitAttributionOverride,
  });

  console.log(
    `[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${redactUrlCredentials(queryParams.options?.env?.ANTHROPIC_BASE_URL) || '[not set]'}`
  );

  const agentCallMeta = {
    sessionId,
    conversationId: activeConversation.id,
    callType: 'runSession',
    agentType,
    model: effectiveModel,
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
    tierContext,
    beforeProviderExecute,
    onProviderDispatchInitiated,
  });
}

function resolveTierMemberSnapshot(tierId, tierName) {
  const configuredMembers = getTierMembersResolved(tierId);
  if (configuredMembers.length === 0) throw new Error(`No members configured for tier "${tierName}" — cannot start session`);
  return configuredMembers;
}
/**
 * Snapshot the member whose turn succeeded (Fix 5 / Fix 3).
 *
 * First-durable-activity pinning happens earlier — at persist time, via
 * {@link tierMemberPin.pinTierMemberOnDurableActivity} — so a member whose
 * turn later ends in a terminal error is still recorded. This success-time
 * path covers the remaining states an activity-time pin cannot distinguish:
 *
 * Snapshot when EITHER:
 *   a) The session completed normally (status is not 'scheduled'), OR
 *   b) The session ran (produced ≥1 assistant message) and was then
 *      proactively rescheduled — in that case status is 'scheduled' but a
 *      turn genuinely completed, so the snapshot should be recorded for the
 *      badge/continue path (Fix 3).
 *
 * Do NOT snapshot when the session was rescheduled without ever producing
 * output (i.e. failed at start and rescheduled by _executeSession) — that
 * would record the failing member as the "active" model.
 *
 * Delegates the actual write to the shared idempotent
 * {@link pinSessionToTierMember}, so success-time and activity-time pinning
 * cannot drift.
 *
 * @param {string} sessionId
 * @param {string} tierRef
 * @param {{ modelId: string, providerId: string }} member
 */
function snapshotSuccessfulMember(sessionId, tierRef, member, attemptToken) {
  const currentSession = sessions.getById(sessionId);
  const wasRescheduled = currentSession?.status === 'scheduled';
  const didRun = !sessionHasNoAssistantMessages(sessionId);
  if (!wasRescheduled || didRun) {
    // Finding 11: scope the late write to the originating tier binding and
    // attempt — a stale completion unwinding after an auto-send handoff (or a
    // newer execution) must not overwrite newer identity.
    pinSessionToTierMember(sessionId, member, { tierRef, attemptToken });
  }
}

/**
 * Run ONE failover-loop attempt and classify its outcome. Returns
 * `{ settled: true, execution }` when this member settles the run (success,
 * rejected dispatch, reschedule, or abort — the execution is returned
 * verbatim, undefined included), and `{ settled: false }` when the attempt
 * failed failover-eligibly and the loop should advance. Terminal failures
 * propagate.
 */
async function runSingleTierAttempt(sessionId, promptWithAttachments, workingDirectory, {
  member, nextMember, resolveNextMember, memberIndex, controller, tierRef, tierId, tierName, attempts,
  systemPrompt, activeConversation, callbacks,
  beforeProviderExecute = null, onProviderDispatchInitiated = null, onFailoverDispatch = null,
}) {
  // Finding 12: user cancellation takes precedence over startup failover —
  // never (re-)register active ownership or dispatch a successor adapter
  // after Stop. Adapters must not be responsible for preventing a new call
  // on an aborted controller. The abort propagates under the existing
  // cancellation contract — never tier exhaustion, a capacity failure, or a
  // successful completion.
  if (isUserStopAbort(controller)) {
    throw controller.signal.reason || new Error('Session execution was aborted');
  }
  const tierContext = {
    currentMemberId: member.modelId,
    currentMemberProviderId: member.providerId,
    currentMemberIndex: memberIndex,
    nextMember,
    resolveNextMember,
    // Explicit failover authorization: ONLY the startup loop may advance to
    // another member. A context without this flag (see
    // buildTierHealthContext) reports member health but can never trigger
    // in-place failover, no matter what else it contains.
    allowFailover: true,
  };

  // _executeSession's finally block removes sessionId from activeSessions after
  // every attempt (success or failure). Re-register it before each retry so
  // concurrency guards (e.g. continueSessionCore's "already processing" check)
  // and abort-signal plumbing stay consistent across the failover loop.
  // Each attempt is a fresh turn for watchdog purposes, so re-stamp the
  // liveness timestamps rather than carrying the previous member's clock.
  activeSessions.set(sessionId, { controller, turnStartedAt: Date.now(), lastEventAt: Date.now() });

  // Attribute this attempt's stream activity to the exact member producing
  // it: the first durable activity persisted during the attempt pins the
  // session to `member`, even if the turn later ends in a terminal error.
  // Overwritten per attempt so only the running member can pin. Scoped to
  // the originating tier binding with an attempt token (finding 11) so a
  // stale attempt can neither pin nor be wiped by another attempt's cleanup.
  const attemptToken = registerTierAttemptMember(sessionId, member, { tierRef });

  const wasPreActivity = sessionHasNoObservableAgentActivity(sessionId);
  let dispatched = false;
  try {
    const execution = await attemptRunWithModel(sessionId, promptWithAttachments, workingDirectory, {
      systemPrompt,
      activeConversation,
      controller,
      callbacks,
      tierContext,
      beforeProviderExecute: async () => {
        await beforeProviderExecute?.();
        // The health check at loop selection is necessarily optimistic. Check
        // once more immediately before the adapter call so a notice can never
        // name a cooled member that was skipped at the dispatch fence.
        if (isUnhealthy(member.providerId, member.modelId)) {
          throw new TierMemberUnavailableAtDispatchError();
        }
      },
      onProviderDispatchInitiated: () => {
        dispatched = true;
        onFailoverDispatch?.();
        onProviderDispatchInitiated?.();
      },
    });

    // A rejected dispatch (e.g. lane-run ownership lost before the provider
    // call) never reached this member's provider, so it is neither a success
    // to snapshot nor a failure to fail over from — surface it verbatim.
    if (execution && !execution.started) return { settled: true, execution, attemptToken, dispatched };

    // A provider may close its iterator normally after emitting result:error,
    // and automatic retry scheduling also intentionally returns normally.
    // Neither outcome is a successful member resolution. A reschedule ends
    // this start without a snapshot; a terminal stream failure enters the
    // same classification/exhaustion path as an iterator rejection.
    if (execution?.outcome === 'rescheduled') return { settled: true, execution, attemptToken, dispatched };
    throwTerminalStreamFailure(execution);

    snapshotSuccessfulMember(sessionId, tierRef, member, attemptToken);
    return { settled: true, execution, attemptToken, dispatched }; // done
  } catch (error) {
    // Finding 12: settle user cancellation before failover classification,
    // member-health reporting, or successor dispatch — including the
    // identity-error branch below. A Stop-aborted attempt whose provider
    // rejects with an eligible capacity error lands as user-paused/cancelled
    // (settled upstream in handleTurnFailure); it must neither cool the
    // member nor advance the loop.
    if (isUserStopAbort(controller)) {
      clearTierAttemptMember(sessionId, attemptToken);
      throw error;
    }
    if (error?.code === 'TIER_MEMBER_UNAVAILABLE_AT_DISPATCH') {
      return { settled: false, attemptToken, dispatched, nextMember: resolveNextMember() };
    }
    const selectedNextMember = classifyAttemptFailure(error, {
      sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
      resolveNextMember,
    });
    return { settled: false, attemptToken, dispatched, error, nextMember: selectedNextMember };
  }
}

function selectInitialCycleMember(sessionId, members, failoverDisabled) {
  // FR0: without automatic failover, startup retains its original configured
  // ordering. A saved resolved member is only the circular origin for an
  // enabled failover cycle.
  if (failoverDisabled) {
    return members.find((candidate) => !isUnhealthy(candidate.providerId, candidate.modelId)) || null;
  }
  const currentSession = sessions.getById(sessionId);
  const pinnedMember = members.find((candidate) => (
    candidate.modelId === currentSession?.resolvedModel
    && candidate.providerId === currentSession?.resolvedProviderId
  ));
  // The configured current member remains this cycle's circular origin even
  // while cooling. The loop below applies health eligibility as it scans
  // forward, so B-cooling in [A,B,C] starts at C rather than resetting to A.
  return pinnedMember
    ? pinnedMember
    : members.find((candidate) => !isUnhealthy(candidate.providerId, candidate.modelId)) || null;
}

function selectNextCycleMember(members, member, attemptedMemberKeys, failoverDisabled) {
  if (failoverDisabled) return null;
  return findNextHealthyTierMemberInSnapshot(members, member, attemptedMemberKeys);
}

function throwCycleTerminalOutcome({ attempts, attemptedAny, dispatchedAny, tierId, tierName }) {
  if (attempts.length) throw new ModelTierExhaustedError({ tierId, tierName, attempts });
  // A dispatch-fence skip has entered an attempt but has not handed work to
  // a provider. Treat a cycle containing only those skips exactly like an
  // initially cooled tier so the start boundary settles it as an error
  // rather than fabricating a successful start receipt.
  if (!attemptedAny || !dispatchedAny) throw createTierCooldownUnavailableError(tierId, tierName);
}

// eslint-disable-next-line max-statements, sonarjs/cognitive-complexity -- cycle membership, health, and dispatch remain one atomic loop.
async function runTierMemberCycle(sessionId, promptWithAttachments, workingDirectory, {
  members, failoverDisabled, controller, tierRef, tierId, tierName,
  systemPrompt, activeConversation, callbacks,
  beforeProviderExecute, onProviderDispatchInitiated,
}) {
  const attempts = [];
  let attemptedAny = false;
  let dispatchedAny = false;
  const attemptedMemberKeys = new Set();
  let latestAttemptToken = null;
  let pendingFailover = null;
  let member = selectInitialCycleMember(sessionId, members, failoverDisabled);
  try {
    while (member && attemptedMemberKeys.size < members.length) {
      const memberKey = tierMemberKey(member);
      if (isUnhealthy(member.providerId, member.modelId)) {
        attemptedMemberKeys.add(memberKey);
        member = selectNextCycleMember(members, member, attemptedMemberKeys, failoverDisabled);
        continue;
      }
      const memberIndex = members.findIndex((candidate) => tierMemberKey(candidate) === memberKey);
      attemptedMemberKeys.add(memberKey);
      const nextMember = selectNextCycleMember(members, member, attemptedMemberKeys, failoverDisabled);
      const resolveNextMember = () => selectNextCycleMember(members, member, attemptedMemberKeys, failoverDisabled);
      attemptedAny = true;
      const result = await runSingleTierAttempt(sessionId, promptWithAttachments, workingDirectory, {
        member, nextMember, resolveNextMember, memberIndex, controller, tierRef, tierId, tierName, attempts,
        systemPrompt, activeConversation, callbacks, beforeProviderExecute, onProviderDispatchInitiated,
        onFailoverDispatch: pendingFailover
          ? () => emitTierFailoverEvent(pendingFailover.error, {
            sessionId,
            member: pendingFailover.member,
            tierRef,
            tierName,
            nextMember: member,
          })
          : null,
      });
      if (result.attemptToken !== undefined) latestAttemptToken = result.attemptToken;
      dispatchedAny ||= result.dispatched;
      if (result.settled) return result.execution;
      // A dispatch-fence skip is not a new provider failure. Retain the
      // original failed member so the eventual concrete dispatch is reported
      // as that failure's replacement, rather than inventing B → C.
      if (result.error) pendingFailover = { error: result.error, member };
      member = result.nextMember ?? selectNextCycleMember(members, member, attemptedMemberKeys, failoverDisabled);
    }
    throwCycleTerminalOutcome({ attempts, attemptedAny, dispatchedAny, tierId, tierName });
  } finally {
    clearTierAttemptMember(sessionId, latestAttemptToken ?? undefined);
  }
}

/**
 * Tier failover loop for `runSessionCore`.
 * Starts at the first healthy configured member then advances through a
 * cycle-local, circular snapshot on eligible start failures.
 */
export async function runSessionWithTierFailover(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierRef,
    beforeProviderExecute = null, onProviderDispatchInitiated = null }
) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) {
    throw new Error(`Invalid tier ref: ${tierRef}`);
  }

  // Freeze configured members once per run. Configuration changes while an
  // attempt is in flight cannot alter this run's retry, reschedule decision,
  // or emitted successor. Cooldown is deliberately applied afterwards: an
  // empty configuration and a temporarily exhausted configuration are
  // different user-visible conditions.
  const tierName = _getTierName(tierId);
  const members = resolveTierMemberSnapshot(tierId, tierName);

  // FR0: a tier with automatic failover disabled never advances to a
  // successor at start — attempt only the resolved (first healthy) member
  // once, then surface the error. The single-member loop below still cools
  // the failed member for future sessions via the normal classification
  // path, and computes no successor, so no TIER_FAILOVER event is emitted.
  // Mirrors the mid-session gates (sessionAgentGuard, tierResolutionService,
  // sessionContinueFailover), which already consult this flag.
  const failoverDisabled = modelTiers.getById(tierId)?.autoFailoverEnabled === false;
  // Ensure the model stored on the session is the tier ref
  sessions.update(sessionId, { model: tierRef });

  return runTierMemberCycle(sessionId, promptWithAttachments, workingDirectory, {
    members, failoverDisabled, controller, tierRef, tierId, tierName,
    systemPrompt, activeConversation, callbacks, beforeProviderExecute, onProviderDispatchInitiated,
  });
}

function _getTierName(tierId) {
  try {
    const tier = modelTiers.getByIdWithMembers(tierId);
    return tier?.name || tierId;
  } catch {
    return tierId;
  }
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
  const { session, tierRef, systemPrompt, activeConversation, controller, callbacks,
    beforeProviderExecute = null, onProviderDispatchInitiated = null } = ctx;
  if (hasResolvableTierMembers(tierRef)) {
    return runSessionWithTierFailover(sessionId, promptWithAttachments, workingDirectory, {
      systemPrompt,
      activeConversation,
      controller,
      callbacks,
      tierRef,
      beforeProviderExecute,
      onProviderDispatchInitiated,
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
    beforeProviderExecute,
    onProviderDispatchInitiated,
  });
}

/**
 * Dispatch a session start down the tier-failover or standard path and settle
 * start-boundary failures. Resolution and tier selection can fail before
 * _executeSession establishes its own error/finally boundary: do not leave
 * the session registered as active or a participating lane run waiting
 * forever for open work.
 */
export async function _dispatchStartPath(sessionId, promptWithAttachments, workingDirectory,
  { startCtx, model, providerId, controller }) {
  const effectiveModelField = model || startCtx.session.model;
  let execution;
  try {
    execution = isTierRef(effectiveModelField)
      ? await _runTierBoundSession(sessionId, promptWithAttachments, workingDirectory, {
        ...startCtx, tierRef: effectiveModelField,
      })
      : await _runStandardSession(sessionId, promptWithAttachments, workingDirectory, {
        ...startCtx, model, providerId,
      });
  } catch (error) {
    // A user stop is not a permanent error: stopSession() already set the
    // status to 'stopped' and paused any open lane obligation, so this catch
    // must not overwrite that state or fail the run. Keep parity with
    // handleTurnFailure — only real failures terminally close own work.
    // A lane-disable park is likewise not a failure: the kanban pause path
    // owns the settlement (settleFenceParkedExecutionState already wrote
    // stopped/stopped; abandonPausedTriggerChild re-settles with fences), so
    // writing 'error' here would overwrite that paused state.
    if (!isUserStopAbort(controller) && error?.code !== 'LANE_AUTOMATION_DISABLED') {
      const sanitizedError = normalizeFinalErrorMessage(error);
      sessions.update(sessionId, { status: 'error', error: sanitizedError });
      broadcastSessionStatus(sessionId, 'error');
      closeOwnWork(sessionId, 'closed_failed', sanitizedError);
    }
    throw error;
  } finally {
    cleanupSessionState(sessionId, false, controller);
  }
  return execution;
}

/** Exposed tier-name lookup shared with the stale-fallback degradation module. */
export { _getTierName as getTierName };

/**
 * Check whether a tier ref currently resolves to at least one attemptable
 * member (tier exists, has ≥1 member whose provider/model is still enabled).
 * Used at session start to distinguish a resolvable tier (proceed to
 * {@link runSessionWithTierFailover}) from a stale/emptied/deleted tier ref
 * (Fix 6 — degrade safely instead of failing outright).
 * @param {string} tierRef
 * @returns {boolean}
 */
export function hasResolvableTierMembers(tierRef) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) return false;
  return getTierMembersResolved(tierId).length > 0;
}
