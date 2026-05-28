/**
 * Workflow coverage validation and repair for root session summaries.
 *
 * When a root session orchestrates child sessions, the LLM-generated root
 * summary can omit material facts from descendants (e.g. files changed or
 * work completed in a child). This module detects and repairs such omissions
 * so that root summaries accurately reflect the entire workflow tree.
 */

import { sessionSummaries } from '../database.js';

/** Maximum key actions to carry up from ALL descendants combined */
const MAX_DESCENDANT_KEY_ACTIONS = 12;

/** Aggregate outcome priority: higher index = "more final" status */
const OUTCOME_PRIORITY = ['ongoing', 'partial', 'failed', 'completed'];

/**
 * Get the "higher priority" of two outcome strings.
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {string}
 */
function higherOutcome(a, b) {
  const ai = OUTCOME_PRIORITY.indexOf(a || 'ongoing');
  const bi = OUTCOME_PRIORITY.indexOf(b || 'ongoing');
  return ai >= bi ? (a || 'ongoing') : (b || 'ongoing');
}

/**
 * Collect the summaries of all descendants that have one.
 * @param {Array} descendants - Session objects (each has at least `id` and `name`)
 * @returns {Array<{session: Object, summary: Object}>} Only those with summaries
 */
function collectDescendantSummaries(descendants) {
  const result = [];
  for (const desc of descendants) {
    const summary = sessionSummaries.getBySessionId(desc.id);
    if (summary) {
      result.push({ session: desc, summary });
    }
  }
  return result;
}

/**
 * Validate and repair workflow coverage of a root summary.
 *
 * Repairs applied (in order):
 *   1. Merge descendant `filesModified` into root `filesModified` (dedup).
 *   2. Carry up material descendant key actions missing from root (up to limit).
 *   3. Upgrade root `outcome` if any descendant has a more final outcome,
 *      preventing "ongoing" when a child completed.
 *
 * @param {Object} summaryData - The root summary data object (will be mutated).
 * @param {Array} descendants - All descendant session objects.
 * @returns {Object} The repaired summaryData (same reference, mutated in-place).
 */
export function validateAndRepairWorkflowCoverage(summaryData, descendants) {
  const pairs = collectDescendantSummaries(descendants);
  if (pairs.length === 0) return summaryData;

  // 1. Merge descendant filesModified into root filesModified (dedup)
  const allFiles = new Set(Array.isArray(summaryData.filesModified) ? summaryData.filesModified : []);
  for (const { summary } of pairs) {
    if (Array.isArray(summary.filesModified)) {
      for (const file of summary.filesModified) {
        allFiles.add(file);
      }
    }
  }
  summaryData.filesModified = Array.from(allFiles);

  // 2. Add material descendant key actions missing from root keyActions
  const existingActions = new Set(
    (Array.isArray(summaryData.keyActions) ? summaryData.keyActions : []).map((a) => a.toLowerCase())
  );
  const candidateActions = [];
  for (const { summary } of pairs) {
    if (Array.isArray(summary.keyActions)) {
      for (const action of summary.keyActions) {
        if (!existingActions.has(action.toLowerCase())) {
          candidateActions.push(action);
          existingActions.add(action.toLowerCase());
        }
      }
    }
  }
  const rootActions = Array.isArray(summaryData.keyActions) ? summaryData.keyActions : [];
  const combined = [...rootActions, ...candidateActions];
  summaryData.keyActions = combined.slice(0, MAX_DESCENDANT_KEY_ACTIONS);

  // 3. Compute aggregate outcome: root should not say "ongoing" if a descendant completed
  let aggregateOutcome = summaryData.outcome || 'ongoing';
  for (const { summary } of pairs) {
    aggregateOutcome = higherOutcome(aggregateOutcome, summary.outcome);
  }
  summaryData.outcome = aggregateOutcome;

  return summaryData;
}

/**
 * Check the fullSummary for missing facts from descendant summaries.
 *
 * Returns a list of human-readable "missing fact" strings for any descendant
 * whose name and outcome do not appear in the root fullSummary.
 *
 * @param {Object} summaryData - The root summary data object.
 * @param {Array} descendants - All descendant session objects.
 * @returns {string[]} List of missing-fact descriptions (empty if none).
 */
export function checkFullSummaryOmissions(summaryData, descendants) {
  const fullSummary = (summaryData.fullSummary || '').toLowerCase();
  const shortSummary = (summaryData.shortSummary || '').toLowerCase();
  const combinedText = `${fullSummary} ${shortSummary}`;

  const pairs = collectDescendantSummaries(descendants);
  const missing = [];

  for (const { session, summary } of pairs) {
    const sessionName = (session.name || '').toLowerCase();
    const namePresent = sessionName && combinedText.includes(sessionName);
    const outcomePresent = summary.outcome && summary.outcome !== 'ongoing'
      && combinedText.includes(summary.outcome);

    // Flag if a non-trivial descendant is entirely unmentioned
    if (!namePresent && summary.outcome && summary.outcome !== 'ongoing') {
      missing.push(
        `Child session "${session.name || session.id}" (outcome: ${summary.outcome}) is not mentioned in the summary`
      );
    } else if (namePresent && !outcomePresent && summary.outcome && summary.outcome !== 'ongoing') {
      missing.push(
        `Child session "${session.name || session.id}" outcome "${summary.outcome}" is not clearly stated`
      );
    }
  }

  return missing;
}

/**
 * Build deterministic fallback text to append to a root fullSummary when the
 * LLM-generated text still omits material descendant work after a retry.
 *
 * @param {Array} descendants - All descendant session objects.
 * @returns {string} Text to append to fullSummary (empty string if no summaries exist).
 */
export function buildFallbackSummaryAddition(descendants) {
  const pairs = collectDescendantSummaries(descendants);
  if (pairs.length === 0) return '';

  const lines = [
    '',
    '[Workflow Note: This session is part of a multi-session workflow. The following child sessions contributed to the outcome:]',
  ];

  for (const { session, summary } of pairs) {
    const name = session.name || `Session ${session.id}`;
    const outcome = summary.outcome || 'ongoing';
    const brief = summary.shortSummary || '(no short summary)';
    lines.push(`- ${name} (${outcome}): ${brief}`);
  }

  return lines.join('\n');
}
