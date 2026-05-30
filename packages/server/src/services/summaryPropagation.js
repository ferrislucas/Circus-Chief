/**
 * Summary propagation utilities for parent-child session relationships.
 *
 * Extracted from summaryService.js for modularity and to keep file sizes
 * within ESLint limits.
 */

import { sessions } from '../database.js';
import { broadcastSessionUpdate } from './summaryBroadcast.js';

/**
 * Propagate summary update to all ancestor sessions, in nearest-parent-to-root
 * order. Awaiting each generation ensures that by the time root is regenerated,
 * all intermediate ancestors already have updated summaries that the root can
 * read for its workflow context.
 *
 * @param {string} sessionId - The child session ID that was updated
 * @param {Function} generateSummaryFn - The generateSummary function (injected to avoid circular deps)
 */
export async function propagateToParent(sessionId, generateSummaryFn) {
  const session = sessions.getById(sessionId);
  if (!session || !session.parentSessionId) return;

  // Walk upward from the immediate parent to the root, collecting all ancestors
  const ancestors = [];
  let current = sessions.getById(session.parentSessionId);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ancestors.push(current.id);
    if (!current.parentSessionId) break;
    current = sessions.getById(current.parentSessionId);
  }

  // Generate ancestors in nearest-parent-to-root order (bottom-up) so that
  // each level sees the updated summary of the level below it.
  for (const ancestorId of ancestors) {
    await generateSummaryFn(ancestorId);
  }
}

/**
 * Propagate PR URL from a child session to its root session.
 * Walks up the parent chain to find the root and sets the PR URL there.
 * Only sets the root's prUrl if it doesn't already have one.
 * @param {string} sessionId - The child session that received a PR URL
 * @param {string} prUrl - The PR URL to propagate
 */
export function propagatePrUrlToParent(sessionId, prUrl) {
  if (!prUrl) return;

  const session = sessions.getById(sessionId);
  if (!session || !session.parentSessionId) return;

  const rootId = sessions.getRootSessionId(sessionId);
  if (!rootId || rootId === sessionId) return;

  const root = sessions.getById(rootId);
  if (!root || root.prUrl || root.prUrlAutoLinkDisabled) return;

  sessions.update(root.id, { prUrl });
  broadcastSessionUpdate(root.id, root.projectId, sessions.getById(root.id));

  console.log(`[SummaryService] Propagated PR URL from session ${sessionId} to root ${root.id}: ${prUrl}`);
}
