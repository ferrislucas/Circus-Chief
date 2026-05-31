/**
 * Staleness detection for session summaries.
 * Extracted from summaryService.js for modularity.
 */

import { sessionSummaries, messages, sessions } from '../database.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';

/**
 * Check if any descendant session has a summary newer than the given timestamp.
 * Used as a fallback for legacy summaries that do not have a workflowFingerprint.
 * @param {string} sessionId
 * @param {number} generatedAt
 * @returns {boolean}
 */
function hasNewerDescendantSummary(sessionId, generatedAt) {
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length === 0) return false;

  const descendantSummaries = sessionSummaries.getBySessionIds(descendantIds);
  return descendantSummaries.some(ds => ds.generatedAt > generatedAt);
}

/**
 * Check if the workflow descendant state has changed since the summary was generated.
 * Uses fingerprint comparison when available, falls back to timestamp-based check.
 *
 * NOTE: This is no longer used by isSummaryStale() — descendant staleness is handled
 * by the propagation pathway (buildMergedParentSummary), not LLM generation.
 * Exported for API consumers (e.g. GET /summary?generate=true) that want a fully
 * up-to-date check.
 *
 * @param {string} sessionId
 * @param {Object} summary - The existing summary
 * @returns {boolean}
 */
export function isDescendantStateStale(sessionId, summary) {
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length === 0) return false;

  if (summary.workflowFingerprint) {
    const currentFingerprint = computeWorkflowFingerprint(sessionId);
    return currentFingerprint !== summary.workflowFingerprint;
  }

  return hasNewerDescendantSummary(sessionId, summary.generatedAt);
}

/**
 * Check own-session message staleness.
 * Returns true if the message metadata has changed since the summary was generated.
 * @param {Object} summary - The existing summary
 * @param {Array} allMessages - All messages for the session
 * @returns {boolean}
 */
function isOwnMessageStateStale(summary, allMessages) {
  if (summary.lastSummarizedMessageId) {
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastMessageId = lastMessage ? lastMessage.id : null;

    if (lastMessageId !== summary.lastSummarizedMessageId) return true;
    if (allMessages.length !== summary.messageCount) return true;
  } else {
    if (allMessages.length !== summary.messageCount) return true;
  }
  return false;
}

/**
 * Check if a summary is stale based on the session's OWN messages only.
 *
 * Staleness detection strategy:
 *   1. No summary exists → always stale.
 *   2. Own message metadata (lastSummarizedMessageId / messageCount) differs → stale.
 *   3. Otherwise → fresh.
 *
 * NOTE: Descendant staleness is intentionally NOT checked here. When children change,
 * the propagation pathway (buildMergedParentSummary in summaryMerge.js) handles parent
 * updates via a cheap deterministic merge — no LLM call needed. Checking descendant
 * staleness here would incorrectly trigger expensive LLM regeneration for parent sessions
 * whenever any child changes.
 *
 * For API consumers needing a full freshness check (own + descendants), call
 * isDescendantStateStale() separately.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);
  return isOwnMessageStateStale(summary, allMessages);
}
