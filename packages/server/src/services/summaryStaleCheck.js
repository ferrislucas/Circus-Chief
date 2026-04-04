/**
 * Staleness detection for session summaries.
 * Extracted from summaryService.js for modularity.
 */

import { sessionSummaries, messages } from '../database.js';

/**
 * Check if a summary is stale (message count or last message ID has changed)
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
    return allMessages.length !== summary.messageCount;
  }

  // Fallback to count-based staleness detection for old summaries
  return allMessages.length !== summary.messageCount;
}
