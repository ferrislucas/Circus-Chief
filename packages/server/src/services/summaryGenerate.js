/**
 * Core summary generation engine.
 *
 * Contains the private helper functions that power _doGenerateSummary.
 * Extracted from summaryService.js to keep that orchestration module under the line limit.
 */

import { sessions, messages, sessionSummaries, projects, settings } from '../database.js';
import { callSummaryModel } from './summaryModelClient.js';
import {
  MAX_MESSAGES,
  MIN_MESSAGES_FOR_SUMMARY,
  MAX_RETRIES,
  SUMMARY_SYSTEM_PROMPT,
  buildIncrementalPrompt,
  parseSummaryResponse,
  trackMessageMetadata,
} from './summaryPrompts.js';
import { enrichPrData } from './prUrlService.js';
import { broadcastSummaryUpdate, broadcastGeneratingStatus, broadcastSessionUpdate } from './summaryBroadcast.js';
import { isSummaryStale } from './summaryStaleCheck.js';
import { hasSemanticSummaryChanged } from './summaryFingerprint.js';
import { propagateToParent as _propagateToParent, propagatePrUrlToParent } from './summaryPropagation.js';
import { buildMergedParentSummary } from './summaryMerge.js';
import { createMinimalSummary } from './summaryMinimal.js';

/**
 * Perform early-exit checks to decide whether summary generation should proceed.
 * @param {string} sessionId
 * @param {boolean} force
 * @param {boolean} userInitiated
 * @returns {{ skip: true, result: Object|null } | { skip: false, session: Object, globalSettings: Object, existingSummary: Object|null, allMessages: Array }}
 */
export function shouldGenerateSummary(sessionId, force, userInitiated) {
  const session = sessions.getById(sessionId);
  if (!session) {
    console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
    return { skip: true, result: null };
  }

  const globalSettings = settings.getSummarySettings();
  if (!userInitiated && globalSettings?.disableSessionSummaries) {
    console.log(`[SummaryService] Session summaries disabled globally, skipping generation`);
    return { skip: true, result: null };
  }

  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  if (existingSummary?.prMerged) {
    console.log(`[SummaryService] Session ${sessionId} has merged PR, skipping regeneration`);
    return { skip: true, result: existingSummary };
  }

  const allMessages = messages.getBySessionId(sessionId);
  if (!force && !isSummaryStale(sessionId)) {
    console.log(`[SummaryService] Summary for ${sessionId} is current, skipping regeneration`);
    return { skip: true, result: existingSummary };
  }

  return { skip: false, session, globalSettings, existingSummary, allMessages };
}

/**
 * Build an existing-summary view that contains only the current session's own
 * LLM-generated state, excluding deterministic child-report content.
 * @param {Object|null} existingSummary
 * @param {boolean} hasDescendants - Whether the session has child sessions
 * @returns {Object|null}
 */
export function buildOwnExistingSummary(existingSummary, hasDescendants) {
  if (!existingSummary) return null;
  return {
    ...existingSummary,
    fullSummary: existingSummary.ownFullSummary ?? (hasDescendants ? '' : existingSummary.fullSummary),
    keyActions: Array.isArray(existingSummary.ownKeyActions)
      ? existingSummary.ownKeyActions
      : [],
    filesModified: Array.isArray(existingSummary.ownFilesModified)
      ? existingSummary.ownFilesModified
      : [],
    outcome: existingSummary.ownOutcome ?? 'ongoing',
  };
}

/**
 * Fetch conversation context for own-session generation.
 * @param {Object} context
 * @returns {{ prompt: string, childContext: Object }}
 */
export function fetchConversationContext({ existingSummary, recentMessages, session, globalSettings, hasDescendants }) {
  const prompt = buildIncrementalPrompt(buildOwnExistingSummary(existingSummary, hasDescendants), recentMessages, session.status, {
    projectTitlePrompt: globalSettings?.sessionTitlePrompt,
    childContext: '',
  });
  return { prompt, childContext: '' };
}

/**
 * Persist the generated summary and broadcast all related updates.
 * @param {string} sessionId
 * @param {Object} summaryData - parsed summary data
 * @param {Object} session
 * @param {Array} allMessages
 * @returns {Promise<Object>} the persisted summary record
 */
export async function saveSummaryResult(sessionId, summaryDataInput, session, allMessages) {
  const summaryData = { ...summaryDataInput };
  delete summaryData._parseFailed;
  trackMessageMetadata(summaryData, allMessages);
  summaryData.ownShortSummary = summaryData.shortSummary;
  summaryData.ownFullSummary = summaryData.fullSummary;
  summaryData.ownKeyActions = Array.isArray(summaryData.keyActions) ? [...summaryData.keyActions] : [];
  summaryData.ownFilesModified = Array.isArray(summaryData.filesModified) ? [...summaryData.filesModified] : [];
  summaryData.ownOutcome = summaryData.outcome || 'ongoing';

  const prUrl = summaryData.prUrl || session.prUrl;
  if (prUrl) {
    const project = projects.getById(session.projectId);
    await enrichPrData(summaryData, prUrl, project?.repoUrl, sessionId);
  }

  let summary = sessionSummaries.upsert(sessionId, summaryData);
  if (sessions.getAllDescendantIds(sessionId).length > 0) {
    summary = buildMergedParentSummary(sessionId);
  }
  console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);
  autoPopulateProjectRepoUrl(session, summaryData);
  updateSessionFromSummary(sessionId, session, summaryData);
  broadcastSummaryUpdate(sessionId, session.projectId, summary);
  return summary;
}

/**
 * Auto-populate the project's repoUrl from summary data if not already set.
 * @param {Object} session
 * @param {Object} summaryData
 */
export function autoPopulateProjectRepoUrl(session, summaryData) {
  const project = projects.getById(session.projectId);
  if (project.repoUrl || (!summaryData.prUrl && !summaryData.repositoryUrl)) return;

  let extractedRepoUrl = summaryData.repositoryUrl;
  if (!extractedRepoUrl && summaryData.prUrl) {
    const prMatch = summaryData.prUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/|$)/);
    if (prMatch) extractedRepoUrl = prMatch[1];
  }

  if (extractedRepoUrl) {
    try {
      projects.update(session.projectId, { repoUrl: extractedRepoUrl });
    } catch (error) {
      console.warn(`[SummaryService] Failed to auto-populate repo URL for project ${session.projectId}:`, error.message);
    }
  }
}

/**
 * Update session name and prUrl from summary data and broadcast changes.
 * @param {string} sessionId
 * @param {Object} session
 * @param {Object} summaryData
 */
export function updateSessionFromSummary(sessionId, session, summaryData) {
  if (summaryData.sessionTitle || summaryData.prUrl) {
    const updateData = {};
    const freshSession = sessions.getById(sessionId);
    const shouldApplySummaryPrUrl = summaryData.prUrl && !freshSession.prUrlAutoLinkDisabled;

    if (summaryData.sessionTitle && !freshSession.manuallyNamed) {
      updateData.name = summaryData.sessionTitle;
    }
    if (shouldApplySummaryPrUrl) updateData.prUrl = summaryData.prUrl;

    const updatedSession = sessions.update(sessionId, updateData);
    if (shouldApplySummaryPrUrl) propagatePrUrlToParent(sessionId, summaryData.prUrl);
    broadcastSessionUpdate(sessionId, session.projectId, updatedSession);
  } else if (session.projectId) {
    broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
  }
}

/**
 * Retry summary generation if parsing failed and retries remain.
 * @param {Object} summaryData
 * @param {number} retryCount
 * @param {Object} ctx
 * @returns {Promise<{ shouldRetry: boolean, result?: Object|null }>}
 */
async function retryIfParseFailed(summaryData, retryCount, { sessionId, force, userInitiated }) {
  if (!summaryData._parseFailed || retryCount >= MAX_RETRIES) {
    return { shouldRetry: false };
  }
  const backoffMs = 1000 * (retryCount + 1);
  await new Promise((resolve) => setTimeout(resolve, backoffMs));
  const result = await _doGenerateSummary(sessionId, retryCount + 1, force, userInitiated);
  return { shouldRetry: true, result };
}

/** Log the reason why summary generation is proceeding (diagnostic, no summary text). */
function _logGenerationReason(sessionId, force, existingSummary) {
  const pfx = `[SummaryService] Generating summary for session ${sessionId}:`;
  if (force) { console.log(`${pfx} forced`); return; }
  if (!existingSummary) { console.log(`${pfx} no existing summary`); return; }
  const ownMsgs = messages.getBySessionId(sessionId);
  const ownStale = (existingSummary.lastSummarizedMessageId && ownMsgs.at(-1)?.id !== existingSummary.lastSummarizedMessageId) || ownMsgs.length !== existingSummary.messageCount;
  console.log(`${pfx} ${ownStale ? 'own messages changed' : 'descendant workflow fingerprint changed'}`);
}

/**
 * Internal generation implementation (no concurrency guard).
 * @param {string} sessionId
 * @param {number} retryCount
 * @param {boolean} force
 * @param {boolean} userInitiated
 * @returns {Promise<Object|null>}
 */
export async function _doGenerateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  const check = shouldGenerateSummary(sessionId, force, userInitiated);
  if (check.skip) return check.result;

  const { session, globalSettings, existingSummary, allMessages } = check;
  _logGenerationReason(sessionId, force, existingSummary);
  const recentMessages = allMessages.slice(-MAX_MESSAGES);

  broadcastGeneratingStatus(sessionId, true);

  try {
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      return createMinimalSummary(sessionId, session, allMessages);
    }

    const hasDescendants = sessions.getAllDescendantIds(sessionId).length > 0;
    const { prompt } = fetchConversationContext({ existingSummary, recentMessages, session, globalSettings, hasDescendants });
    const responseText = await callSummaryModel(prompt, recentMessages, session.status, {
      logMeta: { sessionId, callType: 'generateSessionSummary' },
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      summarySettings: globalSettings,
    });

    const summaryData = parseSummaryResponse(responseText);
    const retryResult = await retryIfParseFailed(summaryData, retryCount, { sessionId, force, userInitiated });
    if (retryResult.shouldRetry) return retryResult.result;

    const summary = await saveSummaryResult(sessionId, summaryData, session, allMessages);
    if (session.parentSessionId && hasSemanticSummaryChanged(existingSummary, summary)) _propagateToParent(sessionId);
    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate summary for session ${sessionId}:`, {
      error: error.message,
      stack: error.stack,
      sessionId,
    });
    return null;
  } finally {
    broadcastGeneratingStatus(sessionId, false);
  }
}
