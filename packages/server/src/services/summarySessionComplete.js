/**
 * Session-completion lifecycle helpers for summary service.
 *
 * Manages CI-check scheduling, outcome mapping, and lightweight outcome-only
 * updates when a session finishes without requiring a full LLM regeneration.
 * Extracted from summaryService.js to keep that orchestration module under the line limit.
 */

import { sessions, sessionSummaries } from '../database.js';
import { isSummaryStale } from './summaryStaleCheck.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';
import { buildMergedParentSummary } from './summaryMerge.js';
import { broadcastSummaryUpdate } from './summaryBroadcast.js';
import { propagateToParent as _propagateToParent } from './summaryPropagation.js';

// Track scheduled CI-check timers so they can be cleared on shutdown
const activeTimers = new Set();

/**
 * Schedule CI status checks for a session with a PR.
 * @param {string} sessionId
 */
export function scheduleCiChecks(sessionId) {
  const makeCheck = (timerId) => async () => {
    activeTimers.delete(timerId);
    const prStatusService = await import('./prStatusService.js');
    prStatusService.checkSessionCiStatusNow(sessionId);
  };
  const timerId1 = setTimeout(() => makeCheck(timerId1)(), 2 * 60 * 1000);
  activeTimers.add(timerId1);
  const timerId2 = setTimeout(() => makeCheck(timerId2)(), 5 * 60 * 1000);
  activeTimers.add(timerId2);
}

/** Map session status to summary outcome. */
export function statusToOutcome(status) {
  if (status === 'error') return 'failed';
  if (status === 'stopped') return 'partial';
  return 'completed';
}

/**
 * Perform lightweight outcome-only update for a current summary.
 * @param {string} sessionId
 * @param {Object} existingSummary
 * @param {Object} session
 * @returns {boolean}
 */
export function tryLightweightOutcomeUpdate(sessionId, existingSummary, session) {
  if (!existingSummary || isSummaryStale(sessionId) || !session) return false;

  const newOutcome = statusToOutcome(session.status);
  if (existingSummary.outcome === newOutcome) return true;

  const updatedData = { ...existingSummary, outcome: newOutcome, ownOutcome: newOutcome };
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length > 0) {
    updatedData.workflowFingerprint = computeWorkflowFingerprint(sessionId);
  }

  let updatedSummary = sessionSummaries.upsert(sessionId, updatedData);
  if (descendantIds.length > 0) {
    updatedSummary = buildMergedParentSummary(sessionId);
  }
  broadcastSummaryUpdate(sessionId, session.projectId, updatedSummary);

  if (session.parentSessionId) {
    try { _propagateToParent(sessionId); } catch { /* best-effort */ }
  }
  return true;
}

/**
 * Clear all pending CI-check timers (called during graceful shutdown).
 */
export function clearScheduledTimers() {
  for (const id of activeTimers) {
    clearTimeout(id);
  }
  activeTimers.clear();
}
