/**
 * Workflow coverage repair and descendant omission handling.
 *
 * Extracted from summaryService.js for modularity and to keep file sizes
 * within ESLint limits.
 */

import { sessions } from '../database.js';
import { callSummaryModel } from './summaryModelClient.js';
import { SUMMARY_SYSTEM_PROMPT, buildIncrementalPrompt, parseSummaryResponse } from './summaryPrompts.js';
import { buildChildSessionContext } from './childSessionContext.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';
import {
  validateAndRepairWorkflowCoverage,
  checkFullSummaryOmissions,
  buildFallbackSummaryAddition,
} from './summaryWorkflowCoverage.js';

/**
 * Attempt to correct omitted descendant facts via a retry LLM call.
 * Returns merged summary data if retry succeeds, or the original if it fails.
 * @param {Object} summaryData - Current summary data
 * @param {string[]} omissions - List of missing facts
 * @param {Object} params - Context parameters
 * @returns {Promise<Object>} Updated summary data
 */
async function retryWithOmissionCorrections(summaryData, omissions, params) {
  const { sessionId, recentMessages, session, globalSettings } = params;
  const correctionNote = `IMPORTANT: The previous summary was missing these descendant facts:\n${omissions.map(o => `- ${o}`).join('\n')}\nPlease include these facts in the updated summary.`;

  try {
    const correctionPrompt = `${correctionNote}\n\n${buildIncrementalPrompt(summaryData, recentMessages, session.status, {
      projectTitlePrompt: globalSettings?.sessionTitlePrompt,
      childContext: buildChildSessionContext(sessionId),
    })}`;
    const retryResponseText = await callSummaryModel(correctionPrompt, recentMessages, session.status, {
      logMeta: { sessionId, callType: 'workflowCoverageRetry' },
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      summarySettings: globalSettings,
    });
    const retrySummaryData = parseSummaryResponse(retryResponseText);
    if (!retrySummaryData._parseFailed) {
      return { ...summaryData, ...retrySummaryData, _parseFailed: undefined };
    }
  } catch (coverageErr) {
    console.warn(`[SummaryService] Workflow coverage retry failed for ${sessionId}:`, coverageErr.message);
  }
  return summaryData;
}

/**
 * Apply workflow coverage repair and descendant omission handling.
 * Returns a new object with the repaired data (does not mutate input).
 * @param {Object} summaryDataInput - The parsed summary data
 * @param {string} sessionId
 * @param {Object} retryParams - Parameters for retry calls
 * @returns {Promise<Object>} The repaired summary data
 */
export async function handleWorkflowCoverageRepair(summaryDataInput, sessionId, retryParams) {
  const descendants = sessions.getByIds(sessions.getAllDescendantIds(sessionId));
  if (descendants.length === 0) return summaryDataInput;

  // Apply repair: merge descendant files/actions, upgrade outcome
  let result = validateAndRepairWorkflowCoverage(summaryDataInput, descendants);

  // Check if the LLM omitted material descendant facts
  const omissions = checkFullSummaryOmissions(result, descendants);
  if (omissions.length > 0) {
    result = await retryWithOmissionCorrections(result, omissions, { sessionId, ...retryParams });

    // Re-apply repair after retry
    result = validateAndRepairWorkflowCoverage(result, descendants);

    // If still omitting after retry, append fallback addition
    const stillMissing = checkFullSummaryOmissions(result, descendants);
    if (stillMissing.length > 0) {
      const fallback = buildFallbackSummaryAddition(descendants);
      if (fallback) {
        result = { ...result, fullSummary: (result.fullSummary || '') + fallback };
      }
    }
  }

  // Compute and store workflow fingerprint (captures final state after all repairs)
  return { ...result, workflowFingerprint: computeWorkflowFingerprint(sessionId) };
}
