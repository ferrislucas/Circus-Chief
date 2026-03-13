/**
 * Child session context building and hierarchy traversal for workflow-aware summaries.
 */

import { sessions, sessionSummaries } from '../database.js';

/**
 * Get all child sessions of a parent session
 * @param {string} parentSessionId - The parent session ID
 * @returns {Array} Array of child sessions
 */
export function getChildSessions(parentSessionId) {
  // Use the SessionRepository's getChildSessions method
  return sessions.getChildSessions(parentSessionId);
}

/**
 * Build child session context for workflow-aware summaries
 * @param {string} sessionId - The session ID
 * @returns {string} Context string describing child sessions
 */
export function buildChildSessionContext(sessionId) {
  const children = getChildSessions(sessionId);
  if (children.length === 0) return '';

  const childContexts = children.map(child => {
    const childSummary = sessionSummaries.getBySessionId(child.id);
    return `- ${child.name} (${child.status}): ${childSummary?.shortSummary || 'No summary yet'}`;
  });

  return `
CHILD SESSIONS (${children.length}):
${childContexts.join('\n')}`;
}

/**
 * Aggregate file counts from this session and all child sessions
 * @param {string} sessionId - The session ID
 * @param {Array} currentFiles - Files from the current session
 * @returns {Array} Deduplicated list of all files modified
 */
export function aggregateFilesModified(sessionId, currentFiles = []) {
  const allFiles = new Set(currentFiles);

  const children = getChildSessions(sessionId);
  for (const child of children) {
    const childSummary = sessionSummaries.getBySessionId(child.id);
    if (childSummary?.filesModified) {
      for (const file of childSummary.filesModified) {
        allFiles.add(file);
      }
    }
    // Recursively aggregate from grandchildren
    const grandchildFiles = aggregateFilesModified(child.id, []);
    for (const file of grandchildFiles) {
      allFiles.add(file);
    }
  }

  return Array.from(allFiles);
}
