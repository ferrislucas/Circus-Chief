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
 * Check if a summary is stale (message count, last message ID, or descendant
 * workflow state has changed since the summary was generated).
 *
 * Staleness detection strategy:
 *   1. No summary exists → always stale.
 *   2. Own message metadata (lastSummarizedMessageId / messageCount) differs → stale.
 *   3. Session has descendants:
 *      a. Summary has a workflowFingerprint: recompute and compare. Stale if different.
 *      b. No workflowFingerprint (legacy summary): fall back to the timestamp-based
 *         hasNewerDescendantSummary check.
 *   4. Otherwise → fresh.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);

  // Message-ID-based own-session staleness (most reliable check)
  if (summary.lastSummarizedMessageId) {
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastMessageId = lastMessage ? lastMessage.id : null;

    if (lastMessageId !== summary.lastSummarizedMessageId) {
      return true;
    }

    // Defensive secondary check: count must also match
    if (allMessages.length !== summary.messageCount) return true;
  } else {
    // Fallback to count-based staleness detection for old summaries
    if (allMessages.length !== summary.messageCount) return true;
  }

  // Workflow descendant staleness checks
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length > 0) {
    if (summary.workflowFingerprint) {
      // Fingerprint-based check: most accurate, catches content changes even when
      // timestamps cannot be trusted (e.g. parent regenerated after child).
      const currentFingerprint = computeWorkflowFingerprint(sessionId);
      if (currentFingerprint !== summary.workflowFingerprint) {
        return true;
      }
    } else {
      // Legacy fallback: summaries generated before fingerprinting was introduced
      // still use the timestamp-based approach.
      if (hasNewerDescendantSummary(sessionId, summary.generatedAt)) {
        return true;
      }
    }
  }

  return false;
}
