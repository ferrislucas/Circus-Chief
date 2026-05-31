/**
 * Deterministic parent summary merge for the incremental merge approach.
 *
 * When a child session changes, the parent's summary is updated by merging
 * child summaries without making any LLM calls. This replaces the previous
 * approach of calling generateSummary() (with a full LLM call) for every
 * ancestor in the propagation chain.
 *
 * Key design:
 * - `ownShortSummary` / `ownFullSummary`: The last LLM-generated content for
 *   the parent's own messages. Stored separately in the DB so it can be reused
 *   when children change without re-calling the LLM.
 * - `shortSummary` / `fullSummary`: The merged result (own + children). This
 *   is what gets broadcast to clients.
 */

import { sessions, sessionSummaries, settings } from '../database.js';
import { broadcastSummaryUpdate } from './summaryBroadcast.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';
import {
  validateAndRepairWorkflowCoverage,
  buildFallbackSummaryAddition,
} from './summaryWorkflowCoverage.js';

/**
 * Synthesize a short summary for a parent that has no own LLM-generated content.
 * Used for orchestrator-only sessions (e.g. ones that only spawn children and
 * have no substantive messages of their own).
 *
 * @param {Object} session - The parent session object
 * @param {Object[]} descendants - All descendant session objects
 * @returns {string}
 */
function synthesizeOrchestratorShortSummary(session, descendants) {
  const total = descendants.length;
  const name = session.name || 'orchestrator session';

  if (total === 0) return `${name}: no child sessions`;

  const failed = descendants.filter((d) => {
    const summary = sessionSummaries.getBySessionId(d.id);
    return d.status === 'error' || summary?.outcome === 'failed';
  }).length;
  const done = descendants.filter((d) => {
    const summary = sessionSummaries.getBySessionId(d.id);
    return d.status === 'stopped' && summary?.outcome !== 'failed';
  }).length;
  const inProgress = Math.max(0, total - done - failed);

  const parts = [];
  if (done > 0) parts.push(`${done} completed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);

  return `Orchestrating ${total} child session${total !== 1 ? 's' : ''}: ${parts.join(', ')}`;
}

/**
 * Build a merged parent summary deterministically from the parent's own
 * LLM-generated content and the summaries of all descendant sessions.
 *
 * This is the core of the incremental merge approach:
 *   - No LLM call is made.
 *   - The parent's own LLM-generated text (`ownShortSummary` / `ownFullSummary`)
 *     is preserved and combined with a structured child-session report.
 *   - Files modified, key actions, and outcome are merged from all descendants
 *     using the existing `validateAndRepairWorkflowCoverage` helpers.
 *   - A fresh `workflowFingerprint` is computed and stored.
 *
 * Backward-compatibility note: For sessions that predate the `own_short_summary` /
 * `own_full_summary` columns (null values), the merged short/full summary is
 * synthesized / built from children only. On the next actual LLM generation
 * (triggered by own message changes), the own fields will be populated.
 *
 * @param {string} sessionId - The parent session ID to update
 * @returns {Object|null} The saved summary record, or null if session not found
 */
export function buildMergedParentSummary(sessionId) {
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) {
    console.log(`[SummaryService] Session summaries disabled globally, skipping merged parent summary for ${sessionId}`);
    return null;
  }

  const session = sessions.getById(sessionId);
  if (!session) return null;

  const existingSummary = sessionSummaries.getBySessionId(sessionId);

  const descendantIds = sessions.getAllDescendantIds(sessionId);
  const descendants = descendantIds.map((id) => sessions.getById(id)).filter(Boolean);

  // Retrieve the parent's own LLM-generated text (null for orchestrator-only sessions
  // or sessions that haven't been regenerated since the column was added).
  const ownShortSummary = existingSummary?.ownShortSummary || null;
  const ownFullSummary = existingSummary?.ownFullSummary || null;
  const ownKeyActions = Array.isArray(existingSummary?.ownKeyActions)
    ? existingSummary.ownKeyActions
    : existingSummary?.keyActions || [];
  const ownFilesModified = Array.isArray(existingSummary?.ownFilesModified)
    ? existingSummary.ownFilesModified
    : existingSummary?.filesModified || [];
  const ownOutcome = existingSummary?.ownOutcome || existingSummary?.outcome || null;

  // Build the child-report section using the established fallback format.
  const childReport = buildFallbackSummaryAddition(descendants);

  // Compose shortSummary: use own if available, else synthesize.
  const shortSummary = ownShortSummary || synthesizeOrchestratorShortSummary(session, descendants);

  // Compose fullSummary: own prose (if any) + child report section.
  const fullSummary = ownFullSummary
    ? `${ownFullSummary}${childReport}`
    : childReport || existingSummary?.fullSummary || '';

  // Start from a base that represents the parent's current state.
  // validateAndRepairWorkflowCoverage will merge in all descendants' files/actions/outcome.
  const baseData = {
    shortSummary,
    fullSummary,
    keyActions: ownKeyActions,
    filesModified: ownFilesModified,
    outcome: ownOutcome,
  };

  // Merge descendant filesModified, keyActions, and outcome.
  const merged = validateAndRepairWorkflowCoverage(baseData, descendants);

  // Assemble the final summary data, preserving own text and message metadata.
  const summaryData = {
    ...merged,
    // Override shortSummary / fullSummary — validateAndRepairWorkflowCoverage does
    // not modify these fields (it only touches files/actions/outcome), but be
    // explicit to guard against future changes.
    shortSummary,
    fullSummary,
    ownShortSummary,
    ownFullSummary,
    ownKeyActions: Array.isArray(existingSummary?.ownKeyActions) ? existingSummary.ownKeyActions : null,
    ownFilesModified: Array.isArray(existingSummary?.ownFilesModified) ? existingSummary.ownFilesModified : null,
    ownOutcome: existingSummary?.ownOutcome || null,
    workflowFingerprint: computeWorkflowFingerprint(sessionId),
    // Preserve the parent's own message metadata so isSummaryStale() can still
    // correctly determine when the parent's own messages have changed.
    messageCount: existingSummary?.messageCount ?? 0,
    lastSummarizedMessageId: existingSummary?.lastSummarizedMessageId ?? null,
  };

  const summary = sessionSummaries.upsert(sessionId, summaryData);
  broadcastSummaryUpdate(sessionId, session.projectId, summary);

  console.log(`[SummaryService] Built merged parent summary for session ${sessionId} (no LLM call)`);
  return summary;
}
