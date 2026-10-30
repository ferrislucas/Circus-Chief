import { sessions, modelTiers } from '../database.js';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import {
  buildTierHealthContext, findNextHealthyTierMemberInSnapshot, getTierMembersResolved, markUnhealthy,
} from './tierResolutionService.js';
import { isExactTierMemberValid, validateExactTierMember } from './tierIdentity.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { isUserStopAbort } from './sessionAbort.js';
import { emitTierFailoverEvent, sanitizeTierFailureReason } from './tierAttemptOutcome.js';
import { isTierFailoverLiftable } from './sessionAgentGuard.js';
import { handleTurnFailure } from './sessionExecution.js';
import { activeSessions } from './sessionExecutionOwnership.js';
import { activeConversationIds, broadcastSessionStatus } from './streamEventHandler.js';

/**
 * Build the tier context for one continuation attempt.
 *
 * Always starts from the health-reporting-only context (mid-conversation
 * cooldown attribution, never failover). The first attempt of a turn may
 * additionally authorize a single same-turn failover retry (§5.2) when ALL of
 * the following hold: the tier has automatic failover enabled (FR0), a
 * healthy successor exists after the member about to be dispatched (FR2),
 * and that successor's kind is liftable (NG3). Anything else stays
 * health-only, preserving today's pinned failure path.
 */
export function buildContinueTierContext(session, effectiveModel, authorizeFailover, opts = {}) {
  // An explicit move off the session's own binding (a concrete-model pick or
  // a different tier) runs tier-free: the turn fails normally with no retry,
  // no member cooling, and no failover event — the explicit choice must never
  // be silently replaced by a tier successor (PR #1180 review #1). A
  // same-tier echo (requestedModel === session.model) is keep-current, not a
  // move, and still authorizes the retry.
  if (opts.explicitOffBindingMove) return null;
  const health = buildTierHealthContext(session, { dispatchedPair: opts.dispatchedPair });
  if (!health || !authorizeFailover || !effectiveModel) return health;
  const tier = modelTiers.getById(parseTierRef(session.model));
  if (tier && tier.autoFailoverEnabled === false) return health;
  // A same-turn continuation cycle freezes its configured membership here.
  // The snapshot is intentionally turn-local (kept in tierContext/retry), so
  // later turns and explicit tier switches still resolve current settings.
  // Exact identity, kind, and cooldown checks remain live when it is used.
  const members = getTierMembersResolved(parseTierRef(session.model));
  const eligible = (member) => isExactTierMemberValid(member.providerId, member.modelId)
    && isTierFailoverLiftable(session.agentType, member.modelId, member.providerId);
  const nextMember = findNextHealthyTierMemberInSnapshot(members, {
    modelId: effectiveModel,
    providerId: health.currentMemberProviderId,
  }, new Set(), eligible);
  if (!nextMember) return health;
  return { ...health, allowFailover: true, allowFailoverAfterActivity: true, members, nextMember };
}

/**
 * Decide whether a failed continuation attempt may retry once on the next
 * tier member (§5.2). Every condition is re-evaluated LIVE against current
 * state within the cycle's frozen membership — the prep-time successor may
 * have cooled or become invalid while the attempt ran.
 *
 * Returns the retry plan, or null when the turn must fail normally.
 */
export function considerContinueFailoverRetry({ sessionId, error, tierContext, controller }) {
  // E3: a user stop wins over any successor dispatch.
  if (isUserStopAbort(controller)) return null;
  if (!tierContext || tierContext.allowFailover !== true) return null;
  if (!matchesStartFailoverEligibleError(error)) return null;
  const session = sessions.getById(sessionId);
  if (!session || !isTierRef(session.model)) return null;
  const fromMember = {
    modelId: tierContext.currentMemberId,
    providerId: tierContext.currentMemberProviderId,
  };
  if (!fromMember.modelId || !fromMember.providerId) return null;
  const members = tierContext.members;
  if (!Array.isArray(members)) return null;
  const nextMember = findNextHealthyTierMemberInSnapshot(members, fromMember, new Set(), (member) => (
    isExactTierMemberValid(member.providerId, member.modelId)
      && isTierFailoverLiftable(session.agentType, member.modelId, member.providerId)
  ));
  if (!nextMember) return null;
  return { fromMember, nextMember, members, error };
}

/**
 * Re-check the captured retry cycle immediately before second dispatch. Tier
 * membership/order remains frozen, while cooldown, exact catalog identity,
 * and kind eligibility remain live. This can advance past a member that was
 * disabled after the first attempt without admitting a newly added member.
 */
export function findHealthyContinueRetryMember(session, retry) {
  if (!retry || !Array.isArray(retry.members)) return null;
  return findNextHealthyTierMemberInSnapshot(retry.members, retry.fromMember, new Set(), (member) => (
    isExactTierMemberValid(member.providerId, member.modelId)
      && isTierFailoverLiftable(session.agentType, member.modelId, member.providerId)
  ));
}

/**
 * Convert a selected frozen-snapshot member into the continuation resolver
 * shape. This validates live identity without consulting current tier
 * membership, so the cycle remains frozen while disabled/deleted identities
 * still block dispatch.
 */
export function resolveFrozenContinueRetryMember(retryMember) {
  const pair = validateExactTierMember(retryMember.providerId, retryMember.modelId);
  return {
    effectiveModel: pair.modelId,
    providerIdHint: pair.providerId,
    persist: { resolvedModel: pair.modelId, resolvedProviderId: pair.providerId },
  };
}

/**
 * Apply a same-turn failover retry's arm-time side effects: cool the failed
 * member exactly once (FR3 — the pre-settlement rethrow skipped health
 * attribution). The failover event is NOT emitted here — it is deferred to
 * second-attempt dispatch (see `emitContinueFailoverDispatched`). Returns
 * the boundary marker injected into the retry prompt so the successor
 * continues the failed turn's transcript instead of re-executing it (NG1).
 */
export function applyContinueFailoverRetry(sessionId, retry) {
  markUnhealthy(retry.fromMember.providerId, retry.fromMember.modelId);
  const reason = sanitizeTierFailureReason(retry.error);
  return `<tier_failover_boundary>
The previous attempt on ${retry.fromMember.modelId} failed (${reason}). The transcript above already contains its partial work — treat that work as done or partially done and DO NOT re-execute it. Continue from where it left off.
</tier_failover_boundary>\n\n`;
}

/**
 * Emit the failover event (G4) at second-attempt dispatch time, naming the
 * member that actually dispatches. The retry arms against a live-resolved
 * successor, but the second attempt re-resolves live again — a tier edit in
 * between can land it on a different member, and the marker must describe the
 * actual switch. Cooling was already applied at arm time; this only emits the
 * broadcast + log entry with the live-resolved target.
 */
export function emitContinueFailoverDispatched(sessionId, unsettledError, dispatchedPair) {
  if (!unsettledError || !dispatchedPair?.model) return;
  const session = sessions.getById(sessionId);
  const tierId = parseTierRef(session?.model);
  const tierName = (tierId && modelTiers.getById(tierId)?.name) || tierId || session?.model;
  emitTierFailoverEvent(unsettledError.error, {
    sessionId,
    member: { modelId: unsettledError.fromMember.modelId, providerId: unsettledError.fromMember.providerId },
    tierRef: session?.model,
    tierName,
    nextMember: { modelId: dispatchedPair.model, providerId: dispatchedPair.providerId },
  });
}

/**
 * Settle a pre-settlement failover rethrow whose retry never materialized
 * (the authorized successor cooled mid-turn). Runs the normal failure path —
 * member cooling, reschedule-or-error — so the turn ends visibly instead of
 * wedging the session as running. Mirrors _executeSession's own convention:
 * 'rescheduled' if the session rescheduled, otherwise the caller rethrows.
 */
export async function settleDeclinedFailoverRethrow({ sessionId, error, callbacks, controller, interactive }) {
  return handleTurnFailure({
    sessionId,
    workflowTurn: null,
    tierContext: buildTierHealthContext(sessions.getById(sessionId)),
    callbacks,
    controller,
    broadcastConversationStateOnError: true,
    errorLabel: 'Continue session error',
    error,
    interactive,
  });
}

/**
 * Settle an unsettled continuation error through the normal failure path.
 * Returns the rescheduled-result shape when the session rescheduled, else
 * null (the caller throws its own error). Encapsulates _executeSession's
 * return-vs-throw convention for the retry loop's settle points.
 */
export async function settleUnsettledContinueError({ sessionId, error, callbacks, controller, interactive }) {
  const outcome = await settleDeclinedFailoverRethrow({ sessionId, error, callbacks, controller, interactive });
  return outcome === 'rescheduled' ? { started: true, outcome: 'rescheduled' } : null;
}

/**
 * Whether re-resolution landed back on the member that just failed (the tier
 * was edited mid-turn). Retrying it would hammer a member known to be down —
 * the turn must settle the original failure instead (FR2).
 */
export function resolvesToFailedMember(modelEnv, unsettledError) {
  if (!unsettledError) return false;
  return modelEnv.effectiveModel === unsettledError.fromMember.modelId
    && (modelEnv.providerIdHint ?? null) === (unsettledError.fromMember.providerId ?? null);
}

/**
 * Arm the turn for its single retry attempt: persist the boundary marker and
 * the unsettled error, cool state already applied, and re-arm running status
 * (the failed attempt's finally released it). Returns the refreshed turn
 * fields for the caller to merge.
 */
export function armContinueFailoverRetry(sessionId, { retry, error, activeConversation, controller }) {
  const failoverBoundary = applyContinueFailoverRetry(sessionId, retry);
  const unsettledError = { error, fromMember: retry.fromMember };
  activeSessions.set(sessionId, { controller, turnStartedAt: Date.now(), lastEventAt: Date.now() });
  activeConversationIds.set(sessionId, activeConversation.id);
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');
  return {
    failoverBoundary,
    unsettledError,
    // The frozen retry plan is not persisted and expires with this one-retry
    // continuation cycle.
    retry,
    session: sessions.getById(sessionId),
  };
}
