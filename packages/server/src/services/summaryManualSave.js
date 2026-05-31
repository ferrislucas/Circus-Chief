import { sessions, messages, sessionSummaries } from '../database.js';
import { trackMessageMetadata } from './summaryPrompts.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';
import { isSummaryStale } from './summaryStaleCheck.js';
import { validateAndRepairWorkflowCoverage } from './summaryWorkflowCoverage.js';

function getOwnedManualFields(data) {
  const owned = {};
  if (data.shortSummary !== undefined) {
    owned.ownShortSummary = data.ownShortSummary ?? data.shortSummary;
  }
  if (data.fullSummary !== undefined) {
    owned.ownFullSummary = data.ownFullSummary ?? data.fullSummary;
  }
  if (data.keyActions !== undefined) {
    owned.ownKeyActions = data.ownKeyActions ?? data.keyActions;
  }
  if (data.filesModified !== undefined) {
    owned.ownFilesModified = data.ownFilesModified ?? data.filesModified;
  }
  if (data.outcome !== undefined) {
    owned.ownOutcome = data.ownOutcome ?? data.outcome;
  }
  return owned;
}

function getDescendants(sessionId) {
  return sessions
    .getAllDescendantIds(sessionId)
    .map(id => sessions.getById(id))
    .filter(Boolean);
}

function getManualWorkflowFingerprint(rootSessionId, descendants, existing) {
  // Batch-fetch all descendant summaries to avoid N+1 queries
  const descendantSummaries = sessionSummaries.getBySessionIds(descendants.map((d) => d.id));
  const summaryBySessionId = new Map(descendantSummaries.map((s) => [s.sessionId, s]));

  const descendantsCurrent = descendants.every((desc) => {
    const summary = summaryBySessionId.get(desc.id);
    return summary && !isSummaryStale(desc.id);
  });
  return descendantsCurrent
    ? computeWorkflowFingerprint(rootSessionId)
    : existing?.workflowFingerprint ?? null;
}

/**
 * Save a manually provided summary while preserving owned parent summary fields.
 * @param {string} sessionId
 * @param {Object} data
 * @returns {Object}
 */
export function saveManualSummary(sessionId, data) {
  const rootSessionId = sessions.getRootSessionId(sessionId) || sessionId;
  const existing = sessionSummaries.getBySessionId(rootSessionId);
  const merged = { ...(existing || {}), ...data, ...getOwnedManualFields(data) };

  if (merged.messageCount == null) {
    trackMessageMetadata(merged, messages.getBySessionId(rootSessionId));
  }

  const descendants = getDescendants(rootSessionId);
  if (descendants.length > 0) {
    Object.assign(merged, validateAndRepairWorkflowCoverage(merged, descendants));
    merged.workflowFingerprint = getManualWorkflowFingerprint(rootSessionId, descendants, existing);
  }

  return sessionSummaries.upsert(rootSessionId, merged);
}
