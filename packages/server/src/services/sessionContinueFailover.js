import { sessions, modelTiers } from '../database.js';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import { buildTierHealthContext, findNextHealthyTierMember, markUnhealthy } from './tierResolutionService.js';
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
export function buildContinueTierContext(session, effectiveModel, authorizeFailover) {
  const health = buildTierHealthContext(session);
  if (!health || !authorizeFailover || !effectiveModel) return health;
  const tier = modelTiers.getById(parseTierRef(session.model));
  if (tier && tier.autoFailoverEnabled === false) return health;
  const nextMember = findNextHealthyTierMember(session.model, {
    modelId: effectiveModel,
    providerId: health.currentMemberProviderId,
  });
  if (!nextMember) return health;
  if (!isTierFailoverLiftable(session.agentType, nextMember.modelId, nextMember.providerId)) return health;
  return { ...health, allowFailover: true, allowFailoverAfterActivity: true, nextMember };
}

/**
 * Decide whether a failed continuation attempt may retry once on the next
 * tier member (§5.2). Every condition is re-evaluated LIVE against current
 * state — the prep-time successor may have cooled while the attempt ran.
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
  const nextMember = findNextHealthyTierMember(session.model, fromMember);
  if (!nextMember) return null;
  if (!isTierFailoverLiftable(session.agentType, nextMember.modelId, nextMember.providerId)) return null;
  return { fromMember, nextMember, error };
}

/**
 * Apply a same-turn failover retry's side effects: cool the failed member
 * exactly once (FR3 — the pre-settlement rethrow skipped health attribution)
 * and emit the failover event (G4). Returns the boundary marker injected into
 * the retry prompt so the successor continues the failed turn's transcript
 * instead of re-executing it (NG1).
 */
export function applyContinueFailoverRetry(sessionId, retry) {
  markUnhealthy(retry.fromMember.providerId, retry.fromMember.modelId);
  const session = sessions.getById(sessionId);
  const tierId = parseTierRef(session?.model);
  const tierName = (tierId && modelTiers.getById(tierId)?.name) || tierId || session?.model;
  emitTierFailoverEvent(retry.error, {
    sessionId,
    member: { modelId: retry.fromMember.modelId, providerId: retry.fromMember.providerId },
    tierRef: session?.model,
    tierName,
    nextMember: retry.nextMember,
  });
  const reason = sanitizeTierFailureReason(retry.error);
  return `<tier_failover_boundary>
The previous attempt on ${retry.fromMember.modelId} failed (${reason}). The transcript above already contains its partial work — treat that work as done or partially done and DO NOT re-execute it. Continue from where it left off.
</tier_failover_boundary>\n\n`;
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
  return { failoverBoundary, unsettledError, session: sessions.getById(sessionId) };
}
