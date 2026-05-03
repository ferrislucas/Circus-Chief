/**
 * Staleness detection for session summaries.
 * Extracted from summaryService.js for modularity.
 */

import { sessionSummaries, messages, sessions } from '../database.js';

/**
 * Check if any descendant session has a summary newer than the given timestamp.
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
 * Check if a summary is stale (message count, last message ID, or descendant summaries have changed)
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);

  // Use message ID-based staleness detection if available
  if (summary.lastSummarizedMessageId) {
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastMessageId = lastMessage ? lastMessage.id : null;

    // Summary is stale if the last message ID doesn't match
    if (lastMessageId !== summary.lastSummarizedMessageId) {
      return true;
    }

    // Also validate count as a secondary check (defensive programming)
    if (allMessages.length !== summary.messageCount) return true;
  }

  // Fallback to count-based staleness detection for old summaries
  if (allMessages.length !== summary.messageCount) return true;

  // Check if any descendant session has a newer summary
  if (hasNewerDescendantSummary(sessionId, summary.generatedAt)) return true;

  return false;
}
