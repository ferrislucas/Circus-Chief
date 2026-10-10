/**
 * tierAttemptOutcome.js — outcome classification for one tier-member attempt.
 *
 * Extracted from sessionTierFailover.js so the failover-loop module stays
 * within its lifecycle size budget. Covers the terminal-stream bridge, the
 * failover-eligibility decision, the failover side effects (broadcast + log),
 * and the exhaustion error. Only leaf dependencies (cooldown registry, error
 * classification, broadcast/log sinks), so no import cycle back to the loop.
 */

import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { sessionHasNoObservableAgentActivity } from './sessionAgentGuard.js';
import { markUnhealthy } from './tierResolutionService.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { broadcastToSession } from '../websocket.js';
import { agentCallLogger } from './agentCallLogger.js';
import { resolveAgentTypeFromModel } from './sessionProvider.js';
import { sanitizeTierFailureReason } from './tierFailureReason.js';
import { TierIdentityError } from './tierIdentity.js';

export { sanitizeTierFailureReason } from './tierFailureReason.js';

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

const terminalStreamFailures = new WeakMap();

export function throwTerminalStreamFailure(execution) {
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
 * Classify a rejected tier-member attempt: record the failure, cool the
 * member, and emit the failover event when eligible. Terminal failures
 * (exhaustion, post-activity staleness) throw; an advanceable failure
 * returns normally so the caller can try the next member.
 *
 * Finding 12 is enforced by the caller before this runs: a Stop-aborted
 * attempt never reaches classification.
 */
export function classifyAttemptFailure(error, {
  sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
}) {
  // Finding 5: the frozen member went stale between the loop-start freeze
  // and its attempt boundary (provider deleted/disabled, model removed or
  // renamed) — resolveInitialSessionModelEnv rejected the exact identity
  // instead of re-routing by model id or to SDK defaults. The member is
  // UNAVAILABLE: cool it, record the attempt, and advance only when a
  // successor exists AND no durable activity happened yet. Replaying the
  // prompt to a different member after observable activity is forbidden, so
  // a post-activity stale member surfaces terminally; with no successor the
  // run exhausts like any other fully-failed tier.
  if (error instanceof TierIdentityError) {
    markUnhealthy(member.providerId, member.modelId);
    attempts.push({
      providerId: member.providerId,
      modelId: member.modelId,
      reason: sanitizeTierFailureReason(error),
    });
    if (nextMember && wasPreActivity) {
      emitTierFailoverEvent(error, { sessionId, member, tierRef, tierName, nextMember });
      return;
    }
    if (!wasPreActivity) throw error;
    throw new ModelTierExhaustedError({ tierId, tierName, attempts });
  }
  // Non-eligible and mid-conversation errors must retain their original
  // protocol. Eligible startup failures are recorded exactly once.
  recordTierAttemptFailure(error, {
    sessionId, member, nextMember, tierRef, tierId, tierName, attempts, wasPreActivity,
  });
}
