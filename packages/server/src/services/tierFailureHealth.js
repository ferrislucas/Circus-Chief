/**
 * tierFailureHealth.js — tier failover health questions asked from the
 * execution path.
 *
 * Extracted from sessionExecution.js (via sessionTierFailover.js) so the
 * execution module stays within its lifecycle size budget. Both helpers are
 * health attribution ONLY — never a failover decision: no successor is
 * advanced and no failover notice is emitted here. Only leaf dependencies
 * (database, error classification, cooldown registry), so any execution
 * module can import this without forming a cycle.
 */

import { sessions } from '../database.js';
import { isTierFailoverEligibleError, matchesStartFailoverEligibleError } from './sessionErrors.js';
import { markUnhealthy } from './tierResolutionService.js';

/**
 * Whether a turn failure may still fail over to a healthy successor.
 * Health-only contexts (a pinned continuation's `allowFailover: false`) and
 * tier-less turns never rethrow-for-failover — the caller keeps them on the
 * normal error path.
 */
export function shouldRethrowForTierFailover(sessionId, error, tierContext) {
  if (!tierContext) return false;
  const currentSession = sessions.getById(sessionId);
  return Boolean(currentSession && isTierFailoverEligibleError(currentSession, error, sessionId, tierContext));
}

/**
 * Report an eligible (rate-limit/quota/availability) failure against the
 * exact concrete member that served this attempt, so subsequent new-session
 * resolutions skip it during cooldown (F21/E7). Works for BOTH kinds of tier
 * context:
 *   - the start loop's failover-authorized context (terminal member / mid-
 *     conversation failures that stay on the normal error path), and
 *   - a pinned continuation's health-reporting-only context
 *     (`allowFailover: false` — see buildTierHealthContext).
 *
 * @param {Error} error
 * @param {Object|null} tierContext
 */
export function reportTierMemberFailureHealth(error, tierContext) {
  if (!tierContext || tierContext.currentMemberId === undefined) return;
  if (!matchesStartFailoverEligibleError(error)) return;
  console.log(
    `[SessionManager] Tier health: member ${tierContext.currentMemberId} (provider ${tierContext.currentMemberProviderId}) marked unhealthy for cooldown — no failover from this attempt`
  );
  markUnhealthy(tierContext.currentMemberProviderId, tierContext.currentMemberId);
}
