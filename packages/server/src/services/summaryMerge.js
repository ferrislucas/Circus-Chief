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

import { sessions, sessionSummaries, messages } from '../database.js';
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

  // Batch-fetch all descendant summaries in a single query
  const descendantSummaries = sessionSummaries.getBySessionIds(descendants.map((d) => d.id));
  const summaryBySessionId = new Map(descendantSummaries.map((s) => [s.sessionId, s]));

  let failed = 0;
  let done = 0;
  for (const d of descendants) {
    const summary = summaryBySessionId.get(d.id);
    if (d.status === 'error' || summary?.outcome === 'failed') {
      failed++;
    } else if (d.status === 'stopped' && summary?.outcome !== 'failed') {
      done++;
    }
  }
  const inProgress = Math.max(0, total - done - failed);

  const parts = [];
  if (done > 0) parts.push(`${done} completed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);

  return `Orchestrating ${total} child session${total !== 1 ? 's' : ''}: ${parts.join(', ')}`;
}

function getOwnSummaryParts(existingSummary) {
  return {
    ownShortSummary: existingSummary?.ownShortSummary ?? null,
    ownFullSummary: existingSummary?.ownFullSummary ?? null,
    ownKeyActions: Array.isArray(existingSummary?.ownKeyActions)
      ? existingSummary.ownKeyActions
      : null,
    ownFilesModified: Array.isArray(existingSummary?.ownFilesModified)
      ? existingSummary.ownFilesModified
      : null,
    ownOutcome: existingSummary?.ownOutcome ?? null,
  };
}

function computeFreshWorkflowFingerprint(sessionId, descendants, existingSummary) {
  // Batch-fetch all descendant summaries to avoid N+1 queries
  const descendantSummaries = sessionSummaries.getBySessionIds(descendants.map((d) => d.id));
  const summaryBySessionId = new Map(descendantSummaries.map((s) => [s.sessionId, s]));

  const descendantsCurrent = descendants.every((desc) => {
    const summary = summaryBySessionId.get(desc.id);
    if (!summary) return false;
    // Inline own-message staleness check (avoids re-fetching summary from DB)
    const descMessages = messages.getBySessionId(desc.id);
    if (summary.lastSummarizedMessageId) {
      const lastMsg = descMessages.length > 0 ? descMessages[descMessages.length - 1] : null;
      if (lastMsg?.id !== summary.lastSummarizedMessageId) return false;
      if (descMessages.length !== summary.messageCount) return false;
    } else {
      if (descMessages.length !== summary.messageCount) return false;
    }
    return true;
  });

  return descendantsCurrent
    ? computeWorkflowFingerprint(sessionId)
    : existingSummary?.workflowFingerprint ?? null;
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
  const session = sessions.getById(sessionId);
  if (!session) return null;

  const existingSummary = sessionSummaries.getBySessionId(sessionId);

  const descendantIds = sessions.getAllDescendantIds(sessionId);
  const descendants = sessions.getByIds(descendantIds);

  const ownParts = getOwnSummaryParts(existingSummary);

  // Batch-fetch all descendant summaries once to avoid double N+1 queries
  // (both buildFallbackSummaryAddition and validateAndRepairWorkflowCoverage
  //  previously each called collectDescendantSummaries() internally).
  const batchSummaries = sessionSummaries.getBySessionIds(descendantIds);
  const summaryBySessionId = new Map(batchSummaries.map((s) => [s.sessionId, s]));
  const descendantPairs = descendants
    .map((d) => ({ session: d, summary: summaryBySessionId.get(d.id) }))
    .filter(({ summary }) => summary != null);

  // Build the child-report section using the established fallback format.
  const childReport = buildFallbackSummaryAddition(descendants, descendantPairs);

  // Compose shortSummary: use own if available, else synthesize.
  const shortSummary = ownParts.ownShortSummary || synthesizeOrchestratorShortSummary(session, descendants);

  // Compose fullSummary: own prose (if any) + child report section.
  const fullSummary = ownParts.ownFullSummary
    ? `${ownParts.ownFullSummary}${childReport}`
    : childReport || existingSummary?.fullSummary || '';

  // Start from a base that represents the parent's current state.
  // validateAndRepairWorkflowCoverage will merge in all descendants' files/actions/outcome.
  // Use empty arrays as fallback for merge when own fields are null (legacy rows).
  const baseData = {
    shortSummary,
    fullSummary,
    keyActions: ownParts.ownKeyActions || [],
    filesModified: ownParts.ownFilesModified || [],
    outcome: ownParts.ownOutcome,
  };

  // Merge descendant filesModified, keyActions, and outcome.
  const merged = validateAndRepairWorkflowCoverage(baseData, descendants, descendantPairs);

  // Assemble the final summary data, preserving own text and message metadata.
  // All own_* fields come from ownParts (single source of truth from DB).
  const summaryData = {
    ...merged,
    // Override shortSummary / fullSummary — validateAndRepairWorkflowCoverage does
    // not modify these fields (it only touches files/actions/outcome), but be
    // explicit to guard against future changes.
    shortSummary,
    fullSummary,
    ownShortSummary: ownParts.ownShortSummary,
    ownFullSummary: ownParts.ownFullSummary,
    ownKeyActions: ownParts.ownKeyActions,
    ownFilesModified: ownParts.ownFilesModified,
    ownOutcome: ownParts.ownOutcome,
    workflowFingerprint: computeFreshWorkflowFingerprint(sessionId, descendants, existingSummary),
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
