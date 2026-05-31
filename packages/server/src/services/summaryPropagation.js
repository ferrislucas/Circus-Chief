/**
 * Summary propagation utilities for parent-child session relationships.
 *
 * Extracted from summaryService.js for modularity and to keep file sizes
 * within ESLint limits.
 */

import { sessions, settings } from '../database.js';
import { broadcastSessionUpdate } from './summaryBroadcast.js';
import { buildMergedParentSummary } from './summaryMerge.js';

/**
 * Propagate summary update to all ancestor sessions, in nearest-parent-to-root
 * order, using a deterministic merge rather than an LLM call.
 *
 * Each ancestor's summary is rebuilt by combining its own LLM-generated text
 * (stored in `ownShortSummary` / `ownFullSummary`) with the latest child
 * summaries — zero tokens consumed. Processing bottom-up ensures that by the
 * time the root is updated, each intermediate ancestor already holds the freshly
 * merged child data.
 *
 * @param {string} sessionId - The child session ID that was updated
 */
export function propagateToParent(sessionId) {
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) {
    console.log(`[SummaryService] Session summaries disabled globally, skipping parent propagation for ${sessionId}`);
    return;
  }

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

  // Merge ancestors in nearest-parent-to-root order (bottom-up) so that
  // each level sees the updated summary of the level below it.
  for (const ancestorId of ancestors) {
    buildMergedParentSummary(ancestorId);
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
