import { sessions, modelTiers } from '../database.js';
import {
  reconcileAgentTypeForRun,
  sessionHasNoAssistantMessages,
  sessionHasNoObservableAgentActivity,
} from './sessionAgentGuard.js';
import { parseTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  getTierMembersResolved,
  markUnhealthy,
  isUnhealthy,
} from './tierResolutionService.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { broadcastToSession } from '../websocket.js';
import { buildQueryParams } from './queryParamBuilder.js';
import { activeSessions } from './streamEventHandler.js';
import {
  createAgentForSession,
  resolveInitialSessionModelEnv,
  _executeSession,
} from './sessionExecution.js';
import { agentCallLogger } from './agentCallLogger.js';
import { resolveAgentTypeFromModel } from './sessionProvider.js';
import { sanitizeTierFailureReason } from './tierFailureReason.js';
import { createTierCooldownUnavailableError } from './tierCooldownUnavailableError.js';
import {
  clearTierAttemptMember,
  pinSessionToTierMember,
  registerTierAttemptMember,
} from './tierMemberPin.js';

export { sanitizeTierFailureReason } from './tierFailureReason.js';

const terminalStreamFailures = new WeakMap();

function throwTerminalStreamFailure(execution) {
  if (execution?.outcome !== 'failed') return;
  terminalStreamFailures.set(execution.error, {
    observableActivityBeforeError: execution.observableActivityBeforeTerminalError,
  });
  throw execution.error;
}

function recordTierAttemptFailure(error, {
  sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
}) {
  const resolvedNextMember = classifyTierMemberFailure(error, {
    sessionId,
    member,
    nextMember,
    tierRef,
    tierName,
    // Terminal stream handling records its visible error before returning
    // control here. Preserve the pre-attempt boundary only when the provider
    // had not produced any activity before its result:error; otherwise the
    // durable tool/output activity must block replay of the prompt.
    preConversationOverride: terminalStreamFailures.get(error)?.observableActivityBeforeError
      ? false
      : (terminalStreamFailures.has(error) ? wasPreActivity : undefined),
  });
  attempts.push({ providerId: member.providerId, modelId: member.modelId, reason: sanitizeTierFailureReason(error) });
  // No successor means this was the terminal real attempt. Do not emit a
  // fake from/to notice; report the complete ordered exhaustion instead.
  if (!resolvedNextMember) throw new ModelTierExhaustedError({ tierId, tierName, attempts });
}

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

  const agentType = reconciledSession.agentType || 'claude-code';
  const agent = createAgentForSession(agentType);

  const { effectiveModel, sessionEnv, commitAttributionOverride } =
    await resolveInitialSessionModelEnv(reconciledSession, memberModelId, memberProviderId);

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

  console.log(
    `[SessionManager] runSession: model=${queryParams.options?.model || '[default]'} baseUrl=${queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]'}`
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

/**
 * Handle a failed tier-member attempt.
 *
 * When the failure is failover-eligible (a start-only service/token error before
 * the conversation has produced any assistant output) and another healthy member
 * exists, marks the member unhealthy, emits a failover event and returns so the
 * caller can advance to the next member. Otherwise rethrows the original error
 * (without emitting a failover event — there is nothing to fail over *to*, so
 * the existing error/auto-reschedule handling, already applied upstream in
 * `_executeSession`, is the correct terminal behavior).
 *
 * @param {Error} error
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string }} ctx
 */
function classifyTierMemberFailure(error, { sessionId, member, nextMember, tierRef, tierName, preConversationOverride }) {
  // Use the tighter failover-specific matcher (Fix 4) to avoid spurious failover
  // on non-quota errors (e.g. "Unexpected token in JSON" contains "token").
  const isEligible = matchesStartFailoverEligibleError(error);
  const isPreActivity = preConversationOverride ?? sessionHasNoObservableAgentActivity(sessionId);

  // Non-eligible error (auth, bad request, abort) or mid-conversation — don't advance
  if (!isEligible || !isPreActivity) {
    throw error;
  }

  // Every retryable provider failure contributes to the shared cooldown,
  // including the terminal member. Otherwise a fully unavailable tier (and
  // especially a single-member tier) is hammered again by every new session.
  markUnhealthy(member.providerId, member.modelId);

  // There IS a next healthy, attemptable member — emit the failover event.
  if (nextMember) emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, nextMember });
  return nextMember;
}

export class ModelTierExhaustedError extends Error {
  constructor({ tierId, tierName, attempts }) {
    const rendered = attempts.map(({ providerId, modelId, reason }) => `${providerId}/${modelId} — ${reason}`).join('; ');
    super(`Model tier "${tierName}" could not start the session. Attempts: ${rendered}.`);
    this.name = 'ModelTierExhaustedError';
    this.code = 'MODEL_TIER_EXHAUSTED';
    this.tierId = tierId;
    this.tierName = tierName;
    this.attempts = attempts;
  }
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
 * Emit the tier-failover side effects (WebSocket broadcast + agent-call log entry)
 * once a member has been confirmed as an eligible failure with a healthy successor.
 * Both the WebSocket payload and the agent-log entry are built from the SAME
 * `nextMember` value computed once by `handleTierMemberFailure` (Fix 5) — they
 * cannot disagree.
 *
 * @param {Error} error
 * @param {{ sessionId: string, member: Object, tierRef: string, tierName: string, nextMember: Object }} ctx
 */
function emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, nextMember }) {
  const reason = sanitizeTierFailureReason(error);
  console.log(
    `[SessionManager] Tier failover: member ${member.modelId} (provider ${member.providerId}) failed; marking unhealthy and advancing to ${nextMember.modelId}`
  );

  // Emit failover event via WebSocket — only fires when we're actually advancing.
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    sessionId,
    tierRef,
    tierName,
    fromModel: member.modelId,
    fromProviderId: member.providerId,
    toModel: nextMember.modelId,
    toProviderId: nextMember.providerId,
    reason,
    timestamp: Date.now(),
  });

  // Write the failover event to the agent log stream (F26)
  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: member.modelId,
      fromProviderId: member.providerId,
      toModel: nextMember.modelId,
      toProviderId: nextMember.providerId,
      tierRef,
      tierName,
      reason,
      // Derive the source member's agent type from its OWN providerId (Fix 1 /
      // Issue 4) instead of assuming 'claude-code' or looking it up by modelId
      // alone — a failover away from a Codex/Gemini member (possibly sharing a
      // modelId with an Anthropic member) must log its own agent type.
      agentType: resolveAgentTypeFromModel(member.modelId, member.providerId),
    });
  } catch (_logErr) {
    // Non-fatal — failover proceeds even if logging fails
  }
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
function snapshotSuccessfulMember(sessionId, tierRef, member) {
  const currentSession = sessions.getById(sessionId);
  const wasRescheduled = currentSession?.status === 'scheduled';
  const didRun = !sessionHasNoAssistantMessages(sessionId);
  if (!wasRescheduled || didRun) {
    pinSessionToTierMember(sessionId, member);
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
  // Overwritten per attempt so only the running member can pin.
  registerTierAttemptMember(sessionId, member);

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
    if (execution && !execution.started) return { settled: true, execution };

    // A provider may close its iterator normally after emitting result:error,
    // and automatic retry scheduling also intentionally returns normally.
    // Neither outcome is a successful member resolution. A reschedule ends
    // this start without a snapshot; a terminal stream failure enters the
    // same classification/exhaustion path as an iterator rejection.
    if (execution?.outcome === 'rescheduled') return { settled: true, execution };
    throwTerminalStreamFailure(execution);

    snapshotSuccessfulMember(sessionId, tierRef, member);
    return { settled: true, execution }; // done
  } catch (error) {
    // Non-eligible and mid-conversation errors must retain their original
    // protocol. Eligible startup failures are recorded exactly once.
    recordTierAttemptFailure(error, {
      sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
    });
  }
  return { settled: false }; // advance to the next member
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
  try {
    for (let memberIndex = 0; memberIndex < attemptableMembers.length; memberIndex++) {
      const member = attemptableMembers[memberIndex];
      const nextMember = attemptableMembers[memberIndex + 1] || null;

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
      if (result.settled) return result.execution;
    }

    if (attempts.length) throw new ModelTierExhaustedError({ tierId, tierName, attempts });
  } finally {
    // Late events from an unwinding stream must never pin the session to a
    // member that is no longer running.
    clearTierAttemptMember(sessionId);
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
