import { sessions, sessionSummaries } from '../database.js';
import { broadcastSummaryUpdate, broadcastSessionUpdate } from './summaryBroadcast.js';
import { buildMergedParentSummary } from './summaryMerge.js';

function buildMinimalSummary(sessionId, session, allMessages) {
  const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
  const outcome = session.status === 'stopped' ? 'partial' : session.status === 'error' ? 'failed' : 'ongoing';
  const messageText = `Session with ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''}`;

  return {
    shortSummary: 'Session in progress',
    fullSummary: messageText,
    keyActions: [],
    filesModified: [],
    outcome,
    ownShortSummary: 'Session in progress',
    ownFullSummary: messageText,
    ownKeyActions: [],
    ownFilesModified: [],
    ownOutcome: outcome,
    messageCount: allMessages.length,
    lastSummarizedMessageId: lastMessage ? lastMessage.id : null,
  };
}

/**
 * Handle sessions with too few messages by creating a minimal summary.
 * @param {string} sessionId
 * @param {Object} session
 * @param {Array} allMessages
 * @returns {Object} the minimal summary
 */
export function createMinimalSummary(sessionId, session, allMessages) {
  const minimalSummary = buildMinimalSummary(sessionId, session, allMessages);
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  let summary = sessionSummaries.upsert(sessionId, minimalSummary);
  if (descendantIds.length > 0) {
    summary = buildMergedParentSummary(sessionId);
  }
  broadcastSummaryUpdate(sessionId, session.projectId, summary);
  if (session.projectId) {
    broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
  }
  return summary;
}
