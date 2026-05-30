/**
 * Child session context building and hierarchy traversal for workflow-aware summaries.
 */

import { sessions, sessionSummaries, messages } from '../database.js';

/** Maximum characters for full summary per descendant */
const MAX_FULL_SUMMARY_CHARS = 1500;
/** Maximum key actions to include per descendant */
const MAX_KEY_ACTIONS = 8;
/** Maximum files modified to include per descendant */
const MAX_FILES_MODIFIED = 20;
/** Total character limit for the workflow context block */
const TOTAL_WORKFLOW_CONTEXT_LIMIT = 12000;

/**
 * Get all child sessions of a parent session
 * @param {string} parentSessionId - The parent session ID
 * @returns {Array} Array of child sessions
 */
export function getChildSessions(parentSessionId) {
  return sessions.getChildSessions(parentSessionId);
}

/**
 * Collect all descendants in breadth-first, creation-time order (same
 * deterministic ordering as summaryFingerprint.js).
 * @param {string} sessionId
 * @returns {Array} All descendant session objects, in tree-path BFS order
 */
function getDescendantsInTreeOrder(sessionId) {
  const result = [];
  const queue = [sessionId];

  while (queue.length > 0) {
    const current = queue.shift();
    const children = sessions.getChildSessions(current);

    const sorted = children.slice().sort((a, b) => {
      const timeDiff = a.createdAt - b.createdAt;
      if (timeDiff !== 0) return timeDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    for (const child of sorted) {
      result.push(child);
      queue.push(child.id);
    }
  }

  return result;
}

/**
 * Format a list section (key actions or files modified).
 * @param {string} label - Section label
 * @param {string[]} items - Items to list
 * @param {number} maxItems - Maximum items to show
 * @param {string[]} lines - Output lines array to push into
 */
function formatListSection(label, items, maxItems, lines) {
  if (items.length === 0) return;
  lines.push(`   ${label}:`);
  const shown = items.slice(0, maxItems);
  for (const item of shown) {
    lines.push(`   - ${item}`);
  }
  if (items.length > maxItems) {
    lines.push(`   - ... and ${items.length - maxItems} more`);
  }
}

/**
 * Format PR/CI details section.
 * @param {Object} summary - Summary object
 * @param {string[]} lines - Output lines array to push into
 */
function formatPrCiSection(summary, lines) {
  const hasPrCi = summary.prState || summary.ciStatus || summary.ciFailures?.length > 0
    || summary.hasMergeConflicts !== null;
  if (!hasPrCi) return;

  lines.push('   PR/CI:');
  if (summary.prState) lines.push(`   - PR state: ${summary.prState}`);
  if (summary.hasMergeConflicts !== null) {
    lines.push(`   - Merge conflicts: ${summary.hasMergeConflicts ? 'yes' : 'no'}`);
  }
  if (summary.ciStatus) lines.push(`   - CI status: ${summary.ciStatus}`);
  const ciFailures = Array.isArray(summary.ciFailures) ? summary.ciFailures : [];
  if (ciFailures.length > 0) {
    lines.push(`   - CI failures: ${ciFailures.join(', ')}`);
  }
}

/**
 * Format a single descendant's context block.
 * @param {Object} session - Session object
 * @param {Object|null} summary - Summary object or null
 * @param {number} index - 1-based display index
 * @returns {string}
 */
function formatDescendantBlock(session, summary, index) {
  const displayName = session.name || `Session ${session.id}`;
  const lines = [];

  lines.push(`${index}. ${displayName}`);
  lines.push(`   Session ID: ${session.id}`);
  lines.push(`   Parent ID: ${session.parentSessionId || 'none'}`);
  lines.push(`   Status: ${session.status}`);

  if (!summary) {
    const msgCount = messages.getBySessionId(session.id).length;
    lines.push(`   (No summary yet — session has ${msgCount} message${msgCount !== 1 ? 's' : ''})`);
    return lines.join('\n');
  }

  if (summary.outcome) {
    lines.push(`   Outcome: ${summary.outcome}`);
  }

  if (summary.shortSummary) {
    lines.push(`   Short summary: ${summary.shortSummary}`);
  }

  if (summary.fullSummary) {
    const truncated = summary.fullSummary.length > MAX_FULL_SUMMARY_CHARS
      ? `${summary.fullSummary.slice(0, MAX_FULL_SUMMARY_CHARS)}... [truncated]`
      : summary.fullSummary;
    lines.push(`   Full summary: ${truncated}`);
  }

  const keyActions = Array.isArray(summary.keyActions) ? summary.keyActions : [];
  formatListSection('Key actions', keyActions, MAX_KEY_ACTIONS, lines);

  const filesModified = Array.isArray(summary.filesModified) ? summary.filesModified : [];
  formatListSection('Files modified', filesModified, MAX_FILES_MODIFIED, lines);

  formatPrCiSection(summary, lines);

  return lines.join('\n');
}

/**
 * Build detailed workflow descendant context for workflow-aware summaries.
 * Replaces the old direct-child one-liner format with recursive detailed context
 * covering ALL descendants in tree-path order.
 *
 * @param {string} sessionId - The session ID (should be the workflow root)
 * @returns {string} Context string describing all descendant sessions
 */
export function buildChildSessionContext(sessionId) {
  const descendants = getDescendantsInTreeOrder(sessionId);
  if (descendants.length === 0) return '';

  const blocks = [];
  for (let i = 0; i < descendants.length; i++) {
    const desc = descendants[i];
    const summary = sessionSummaries.getBySessionId(desc.id);
    blocks.push(formatDescendantBlock(desc, summary, i + 1));
  }

  const header = `\nWORKFLOW DESCENDANT SUMMARIES:\n`;
  const body = blocks.join('\n\n');
  const full = header + body;

  if (full.length <= TOTAL_WORKFLOW_CONTEXT_LIMIT) {
    return full;
  }

  // Truncate at the limit and append marker
  return `${full.slice(0, TOTAL_WORKFLOW_CONTEXT_LIMIT)}\n... [workflow context truncated]`;
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
