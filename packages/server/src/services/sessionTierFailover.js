import { sessions, modelTiers } from '../database.js';
import {
  reconcileAgentTypeForRun,
  sessionHasNoAssistantMessages,
  sessionHasNoObservableAgentActivity,
} from './sessionAgentGuard.js';
import { parseTierRef } from '@circuschief/shared';
import {
  getTierMembersResolved,
  isUnhealthy,
} from './tierResolutionService.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions } from './sessionExecutionOwnership.js';
import {
  createAgentForSession,
  resolveInitialSessionModelEnv,
  _executeSession,
} from './sessionExecution.js';
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
  throwTerminalStreamFailure,
} from './tierAttemptOutcome.js';

export { sanitizeTierFailureReason } from './tierFailureReason.js';
export { ModelTierExhaustedError } from './tierAttemptOutcome.js';

/**
 * Execute a single attempt with a concrete (model, providerId) pair.
 * Extracted so the tier failover loop can call it with different members.
 */
async function attemptRunWithModel(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierContext }
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
  });
}

function resolveAttemptableTierMembers(tierId, tierName) {
  const configuredMembers = getTierMembersResolved(tierId);
  if (configuredMembers.length === 0) throw new Error(`No members configured for tier "${tierName}" — cannot start session`);

  const attemptableMembers = configuredMembers.filter((member) => !isUnhealthy(member.providerId, member.modelId));
  if (attemptableMembers.length === 0) {
    throw createTierCooldownUnavailableError(tierId, tierName);
  }
  return attemptableMembers;
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
  member, nextMember, memberIndex, controller, tierRef, tierId, tierName, attempts,
  systemPrompt, activeConversation, callbacks,
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
  try {
    const execution = await attemptRunWithModel(sessionId, promptWithAttachments, workingDirectory, {
      systemPrompt,
      activeConversation,
      controller,
      callbacks,
      tierContext,
    });

    // A rejected dispatch (e.g. lane-run ownership lost before the provider
    // call) never reached this member's provider, so it is neither a success
    // to snapshot nor a failure to fail over from — surface it verbatim.
    if (execution && !execution.started) return { settled: true, execution, attemptToken };

    // A provider may close its iterator normally after emitting result:error,
    // and automatic retry scheduling also intentionally returns normally.
    // Neither outcome is a successful member resolution. A reschedule ends
    // this start without a snapshot; a terminal stream failure enters the
    // same classification/exhaustion path as an iterator rejection.
    if (execution?.outcome === 'rescheduled') return { settled: true, execution, attemptToken };
    throwTerminalStreamFailure(execution);

    snapshotSuccessfulMember(sessionId, tierRef, member, attemptToken);
    return { settled: true, execution, attemptToken }; // done
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
    classifyAttemptFailure(error, {
      sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
    });
  }
  return { settled: false, attemptToken }; // advance to the next member
}

/**
 * Tier failover loop for `runSessionCore`.
 * Iterates healthy tier members in position order, retrying on eligible start failures.
 */
export async function runSessionWithTierFailover(
  sessionId,
  promptWithAttachments,
  workingDirectory,
  { systemPrompt, activeConversation, controller, callbacks, tierRef }
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
  const attemptableMembers = resolveAttemptableTierMembers(tierId, tierName);

  // Ensure the model stored on the session is the tier ref
  sessions.update(sessionId, { model: tierRef });

  const attempts = [];
  let attemptedAny = false;
  // Finding 11: the token of the most recent attempt registration. The loop
  // exit clears only that registration — a stale outer `finally` unwinding
  // after a successor (auto-send continuation, newer execution) registered
  // itself must never wipe the successor's ownership.
  let latestAttemptToken = null;
  try {
    for (let memberIndex = 0; memberIndex < attemptableMembers.length; memberIndex++) {
      const member = attemptableMembers[memberIndex];
      // Re-check cooldown before every attempt against the frozen member
      // list (the list itself never re-reads live configuration mid-run):
      // a member cooled after the loop-start snapshot — by a concurrent
      // session, or by an earlier attempt's attribution — must be skipped,
      // never hammered. The successor handed to the reschedule decision and
      // the failover event is likewise the next STILL-HEALTHY member, so a
      // cooled successor can neither suppress rescheduling nor be announced.
      if (isUnhealthy(member.providerId, member.modelId)) continue;
      const nextMember = attemptableMembers
        .slice(memberIndex + 1)
        .find((candidate) => !isUnhealthy(candidate.providerId, candidate.modelId)) || null;

      attemptedAny = true;
      const result = await runSingleTierAttempt(sessionId, promptWithAttachments, workingDirectory, {
        member,
        nextMember,
        memberIndex,
        controller,
        tierRef,
        tierId,
        tierName,
        attempts,
        systemPrompt,
        activeConversation,
        callbacks,
      });
      if (result.attemptToken !== undefined) latestAttemptToken = result.attemptToken;
      if (result.settled) return result.execution;
    }

    if (attempts.length) throw new ModelTierExhaustedError({ tierId, tierName, attempts });
    if (!attemptedAny) {
      // Every frozen member was cooled before its attempt: the tier is
      // temporarily exhausted, exactly as if the loop-start snapshot had
      // found nothing attemptable.
      throw createTierCooldownUnavailableError(tierId, tierName);
    }
  } finally {
    // Late events from an unwinding stream must never pin the session to a
    // member that is no longer running.
    clearTierAttemptMember(sessionId, latestAttemptToken ?? undefined);
  }
}

function _getTierName(tierId) {
  try {
    const tier = modelTiers.getByIdWithMembers(tierId);
    return tier?.name || tierId;
  } catch {
    return tierId;
  }
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
