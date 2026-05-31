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
 * Merge descendant filesModified into the root set (dedup).
 * @param {string[]} rootFiles - Root session's filesModified
 * @param {Array} pairs - Descendant summary pairs
 * @returns {string[]} Deduplicated merged files list
 */
function mergeDescendantFiles(rootFiles, pairs) {
  const allFiles = new Set(Array.isArray(rootFiles) ? rootFiles : []);
  for (const { summary } of pairs) {
    if (Array.isArray(summary.filesModified)) {
      for (const file of summary.filesModified) {
        allFiles.add(file);
      }
    }
  }
  return Array.from(allFiles);
}

/**
 * Collect unique actions from a summary's keyActions that aren't already in the set.
 * @param {Object} summary - Descendant summary
 * @param {Set} existingActions - Set of lowercase action strings already seen
 * @param {string[]} candidateActions - Array to push new actions into
 */
function collectUniqueActions(summary, existingActions, candidateActions) {
  if (!Array.isArray(summary.keyActions)) return;
  for (const action of summary.keyActions) {
    if (!existingActions.has(action.toLowerCase())) {
      candidateActions.push(action);
      existingActions.add(action.toLowerCase());
    }
  }
}

/**
 * Merge descendant key actions into the root list (dedup, up to limit).
 * @param {string[]} rootActions - Root session's keyActions
 * @param {Array} pairs - Descendant summary pairs
 * @returns {string[]} Combined key actions list
 */
function mergeDescendantActions(rootActions, pairs) {
  const existingActions = new Set(
    (Array.isArray(rootActions) ? rootActions : []).map((a) => a.toLowerCase())
  );
  const candidateActions = [];
  for (const { summary } of pairs) {
    collectUniqueActions(summary, existingActions, candidateActions);
  }
  const combined = [...(Array.isArray(rootActions) ? rootActions : []), ...candidateActions];
  return combined.slice(0, MAX_DESCENDANT_KEY_ACTIONS);
}

/**
 * Compute aggregate outcome across root and all descendants.
 * @param {string} rootOutcome - Root session's outcome
 * @param {Array} pairs - Descendant summary pairs
 * @returns {string} The highest-priority outcome
 */
function computeAggregateOutcome(rootOutcome, pairs) {
  const outcomes = pairs.map(({ summary }) => summary.outcome).filter(Boolean);
  if (!rootOutcome) {
    if (outcomes.includes('failed')) return 'failed';
    if (outcomes.includes('ongoing')) return 'ongoing';
    if (outcomes.includes('partial')) return 'partial';
    if (outcomes.includes('completed')) return 'completed';
    return 'ongoing';
  }
  if (outcomes.includes('failed')) return 'failed';
  if (rootOutcome === 'failed') return 'failed';
  if (rootOutcome === 'ongoing' || outcomes.includes('ongoing')) return 'ongoing';
  if (rootOutcome === 'partial' || outcomes.includes('partial')) return 'partial';
  if (rootOutcome === 'completed' || outcomes.includes('completed')) return 'completed';
  return 'ongoing';
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
 * @param {Object} summaryData - The root summary data object.
 * @param {Array} descendants - All descendant session objects.
 * @returns {Object} A new object with repaired data (original not mutated).
 */
export function validateAndRepairWorkflowCoverage(summaryData, descendants) {
  const pairs = collectDescendantSummaries(descendants);
  if (pairs.length === 0) return summaryData;

  return {
    ...summaryData,
    filesModified: mergeDescendantFiles(summaryData.filesModified, pairs),
    keyActions: mergeDescendantActions(summaryData.keyActions, pairs),
    outcome: computeAggregateOutcome(summaryData.outcome, pairs),
  };
}

/**
 * Check if a descendant's presence in the summary text indicates an omission.
 * @param {Object} session - Session object
 * @param {Object} summary - Descendant summary object
 * @param {string} combinedText - Lowercase combined summary text
 * @returns {string|null} Missing-fact description, or null if no omission
 */
function checkDescendantOmission(session, summary, combinedText) {
  const sessionName = (session.name || '').toLowerCase();
  const namePresent = sessionName && combinedText.includes(sessionName);
  const outcomeText = summary.outcome || '';
  const outcomePresent = outcomeText && outcomeText !== 'ongoing'
    && combinedText.includes(outcomeText);
  const hasFinalOutcome = outcomeText && outcomeText !== 'ongoing';

  if (!hasFinalOutcome) return null;

  if (!namePresent) {
    return `Child session "${session.name || session.id}" (outcome: ${outcomeText}) is not mentioned in the summary`;
  }
  if (!outcomePresent) {
    return `Child session "${session.name || session.id}" outcome "${outcomeText}" is not clearly stated`;
  }
  return null;
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
    const omission = checkDescendantOmission(session, summary, combinedText);
    if (omission) missing.push(omission);
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
