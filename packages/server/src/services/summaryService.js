/**
 * Session summary orchestration service.
 *
 * Coordinates summary generation, staleness detection, lifecycle hooks,
 * and concurrency management. Delegates to extracted modules:
 * - summaryClaudeClient.js — Claude SDK interaction
 * - summaryPrompts.js — prompt templates, parsing, formatting
 * - prUrlService.js — PR URL extraction, validation, enrichment
 * - childSessionContext.js — child session hierarchy and file aggregation
 * - withConcurrencyGuard.js — concurrency guard utility
 * - summaryBroadcast.js — WebSocket broadcast helpers
 * - summaryCoverageRepair.js — workflow coverage repair and retry logic
 * - summaryPropagation.js — parent propagation utilities
 */

import { sessions, messages, sessionSummaries, projects, settings } from '../database.js';
import { createConcurrencyGuard } from './withConcurrencyGuard.js';
import { callSummaryModel } from './summaryModelClient.js';
import {
  MAX_MESSAGES,
  MIN_MESSAGES_FOR_SUMMARY,
  MAX_RETRIES,
  DEFAULT_SESSION_TITLE_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  formatMessages,
  buildIncrementalPrompt,
  parseSummaryResponse,
  trackMessageMetadata,
  stripMarkdownCodeBlock,
} from './summaryPrompts.js';
import { extractPrUrlIfNeeded, parsePrUrl, validatePrUrl, enrichPrData } from './prUrlService.js';
import { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './childSessionContext.js';
import { broadcastSummaryUpdate, broadcastGeneratingStatus, broadcastSessionUpdate } from './summaryBroadcast.js';
import { isDescendantStateStale, isSummaryStale } from './summaryStaleCheck.js';
import { computeWorkflowFingerprint, hasSemanticSummaryChanged } from './summaryFingerprint.js';
import { validateAndRepairWorkflowCoverage } from './summaryWorkflowCoverage.js';
import { propagateToParent as _propagateToParent, propagatePrUrlToParent } from './summaryPropagation.js';
import { buildMergedParentSummary } from './summaryMerge.js';

// Note: prStatusService is imported dynamically in onSessionComplete to avoid circular dependency

// Create the concurrency guard instance for summary generation
const guard = createConcurrencyGuard();

// Track scheduled CI-check timers so they can be cleared on shutdown
const activeTimers = new Set();

/**
 * Generate summary for a session using Claude Code SDK (with concurrency guard)
 * Only one generation can be in-flight per session at a time. If a generation is already
 * running, the call is coalesced and a single follow-up generation is scheduled after completion.
 * @param {string} sessionId
 * @param {number} retryCount - Internal retry counter (do not set manually)
 * @param {boolean} force - Force generation even if summary is current (default: false)
 * @param {boolean} userInitiated - Whether triggered by explicit user action (default: false)
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  if (guard.isActive(sessionId) && !userInitiated) {
    console.log(`[SummaryService] Coalescing summary generation for session ${sessionId} (generation already in-flight)`);
  }
  return guard.run(
    sessionId,
    () => _doGenerateSummary(sessionId, retryCount, force, userInitiated),
    {
      bypass: userInitiated,
      onFollowUp: (key) => generateSummary(key),
    }
  );
}

/**
 * Perform early-exit checks to decide whether summary generation should proceed.
 * @param {string} sessionId
 * @param {boolean} force
 * @param {boolean} userInitiated
 * @returns {{ skip: true, result: Object|null } | { skip: false, session: Object, globalSettings: Object, existingSummary: Object|null, allMessages: Array }}
 */
function shouldGenerateSummary(sessionId, force, userInitiated) {
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
 * @returns {Object|null}
 */
function buildOwnExistingSummary(existingSummary) {
  if (!existingSummary) return null;
  return {
    ...existingSummary,
    fullSummary: existingSummary.ownFullSummary || existingSummary.fullSummary,
    keyActions: Array.isArray(existingSummary.ownKeyActions)
      ? existingSummary.ownKeyActions
      : existingSummary.keyActions || [],
    filesModified: Array.isArray(existingSummary.ownFilesModified)
      ? existingSummary.ownFilesModified
      : existingSummary.filesModified || [],
    outcome: existingSummary.ownOutcome || existingSummary.outcome || 'ongoing',
  };
}

/**
 * Fetch conversation context for own-session generation.
 * @param {string} sessionId
 * @param {Object} context
 * @returns {{ prompt: string, childContext: Object }}
 */
function fetchConversationContext(sessionId, { existingSummary, recentMessages, session, globalSettings }) {
  const prompt = buildIncrementalPrompt(buildOwnExistingSummary(existingSummary), recentMessages, session.status, {
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
async function saveSummaryResult(sessionId, summaryDataInput, session, allMessages) {
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
function autoPopulateProjectRepoUrl(session, summaryData) {
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
function updateSessionFromSummary(sessionId, session, summaryData) {
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
 * Handle sessions with too few messages by creating a minimal summary.
 * @param {string} sessionId
 * @param {Object} session
 * @param {Array} allMessages
 * @returns {Object} the minimal summary
 */
function createMinimalSummary(sessionId, session, allMessages) {
  const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
  const outcome = session.status === 'stopped' ? 'partial' : session.status === 'error' ? 'failed' : 'ongoing';

  const minimalSummary = {
    shortSummary: 'Session in progress',
    fullSummary: `Session with ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''}`,
    keyActions: [],
    filesModified: [],
    outcome,
    ownShortSummary: 'Session in progress',
    ownFullSummary: `Session with ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''}`,
    ownKeyActions: [],
    ownFilesModified: [],
    ownOutcome: outcome,
    messageCount: allMessages.length,
    lastSummarizedMessageId: lastMessage ? lastMessage.id : null,
  };

  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length > 0) {
    minimalSummary.workflowFingerprint = computeWorkflowFingerprint(sessionId);
  }

  let summary = sessionSummaries.upsert(sessionId, minimalSummary);
  if (descendantIds.length > 0) {
    summary = buildMergedParentSummary(sessionId);
  }
  broadcastSummaryUpdate(sessionId, session.projectId, summary);
  if (session.projectId) {
    broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
  }
  return summary;
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

async function _doGenerateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
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

    const { prompt } = fetchConversationContext(sessionId, { existingSummary, recentMessages, session, globalSettings });
    const responseText = await callSummaryModel(prompt, recentMessages, session.status, {
      logMeta: { sessionId, callType: 'generateSessionSummary' },
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      summarySettings: globalSettings,
    });

    let summaryData = parseSummaryResponse(responseText);
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

/**
 * Generate summary immediately and wait for completion (synchronous)
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummaryNow(sessionId) {
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) return null;
  return generateSummary(sessionId);
}

/**
 * Trigger summary generation on session activity (e.g., turn completion).
 * @param {string} sessionId
 */
export function onSessionActivity(sessionId) {
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) return;

  generateSummary(sessionId).catch((err) => {
    console.error(`[SummaryService] Failed to generate summary on activity for session ${sessionId}:`, err);
  });
}

/**
 * Schedule CI status checks for a session with a PR.
 * @param {string} sessionId
 */
function scheduleCiChecks(sessionId) {
  const makeCheck = (timerId) => async () => {
    activeTimers.delete(timerId);
    const prStatusService = await import('./prStatusService.js');
    prStatusService.checkSessionCiStatusNow(sessionId);
  };
  const timerId1 = setTimeout(() => makeCheck(timerId1)(), 2 * 60 * 1000);
  activeTimers.add(timerId1);
  const timerId2 = setTimeout(() => makeCheck(timerId2)(), 5 * 60 * 1000);
  activeTimers.add(timerId2);
}

/** Map session status to summary outcome. */
function statusToOutcome(status) {
  if (status === 'error') return 'failed';
  if (status === 'stopped') return 'partial';
  return 'completed';
}

/**
 * Perform lightweight outcome-only update for a current summary.
 * @param {string} sessionId
 * @param {Object} existingSummary
 * @param {Object} session
 * @returns {boolean}
 */
function tryLightweightOutcomeUpdate(sessionId, existingSummary, session) {
  if (!existingSummary || isSummaryStale(sessionId) || !session) return false;

  const newOutcome = statusToOutcome(session.status);
  if (existingSummary.outcome === newOutcome) return true;

  const updatedData = { ...existingSummary, outcome: newOutcome, ownOutcome: newOutcome };
  const descendantIds = sessions.getAllDescendantIds(sessionId);
  if (descendantIds.length > 0) {
    updatedData.workflowFingerprint = computeWorkflowFingerprint(sessionId);
  }

  let updatedSummary = sessionSummaries.upsert(sessionId, updatedData);
  if (descendantIds.length > 0) {
    updatedSummary = buildMergedParentSummary(sessionId);
  }
  broadcastSummaryUpdate(sessionId, session.projectId, updatedSummary);

  if (session.parentSessionId) {
    _propagateToParent(sessionId).catch(() => {});
  }
  return true;
}

/**
 * Called when session completes - generate immediately if summary is stale,
 * otherwise do a lightweight outcome-only DB update (no LLM call).
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  const globalSettings = settings.getSummarySettings();
  const session = sessions.getById(sessionId);

  if (session?.prUrl) scheduleCiChecks(sessionId);
  if (globalSettings?.disableSessionSummaries) return;

  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  if (tryLightweightOutcomeUpdate(sessionId, existingSummary, session)) return;

  generateSummary(sessionId);
}

/**
 * Get summary for a session, generating if needed
 * @param {string} sessionId
 * @param {boolean} generateIfMissing
 * @returns {Promise<Object|null>}
 */
export async function getSummary(sessionId, generateIfMissing = false) {
  let summary = sessionSummaries.getBySessionId(sessionId);

  if (!summary && generateIfMissing) {
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) return null;
    summary = await generateSummary(sessionId);
  }

  if (summary && isDescendantStateStale(sessionId, summary)) {
    summary = buildMergedParentSummary(sessionId);
  }

  return summary;
}

/**
 * Force regenerate summary for a session (user-initiated action)
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function regenerateSummary(sessionId) {
  return generateSummary(sessionId, 0, true, true);
}

/**
 * Save a manually provided summary (e.g. from PUT /api/sessions/:id/summary).
 * @param {string} sessionId
 * @param {Object} data
 * @returns {Object}
 */
export function saveManualSummary(sessionId, data) {
  const rootSessionId = sessions.getRootSessionId(sessionId) || sessionId;
  const existing = sessionSummaries.getBySessionId(rootSessionId);
  const merged = { ...(existing || {}), ...data };
  if (data.shortSummary !== undefined) merged.ownShortSummary = data.ownShortSummary ?? data.shortSummary;
  if (data.fullSummary !== undefined) merged.ownFullSummary = data.ownFullSummary ?? data.fullSummary;
  if (data.keyActions !== undefined) merged.ownKeyActions = data.ownKeyActions ?? data.keyActions;
  if (data.filesModified !== undefined) merged.ownFilesModified = data.ownFilesModified ?? data.filesModified;
  if (data.outcome !== undefined) merged.ownOutcome = data.ownOutcome ?? data.outcome;

  if (merged.messageCount == null) {
    trackMessageMetadata(merged, messages.getBySessionId(rootSessionId));
  }

  const descendantIds = sessions.getAllDescendantIds(rootSessionId);
  const descendants = descendantIds.map(id => sessions.getById(id)).filter(Boolean);

  if (descendants.length > 0) {
    const repaired = validateAndRepairWorkflowCoverage(merged, descendants);
    Object.assign(merged, repaired);
    merged.workflowFingerprint = computeWorkflowFingerprint(rootSessionId);
  }

  return sessionSummaries.upsert(rootSessionId, merged);
}

/**
 * Propagate summary update to all ancestor sessions using deterministic merge.
 * Delegates to summaryPropagation module (no LLM call, no token cost).
 * @param {string} sessionId
 */
export async function propagateToParent(sessionId) {
  return _propagateToParent(sessionId);
}

// Re-export isSummaryStale from summaryStaleCheck.js for backward compatibility
export { isSummaryStale };

/**
 * Clean up any in-flight state for a session (call on session deletion)
 * @param {string} sessionId
 */
export function cleanupSession(sessionId) {
  guard.cleanup(sessionId);
}

// Re-export from extracted modules for backward compatibility
export {
  MAX_MESSAGES, MIN_MESSAGES_FOR_SUMMARY, MAX_RETRIES, DEFAULT_SESSION_TITLE_PROMPT,
  SUMMARY_SYSTEM_PROMPT, formatMessages, buildIncrementalPrompt, parseSummaryResponse,
  stripMarkdownCodeBlock as _stripMarkdownCodeBlock, trackMessageMetadata as _trackMessageMetadata,
  updateSessionFromSummary as _updateSessionFromSummary,
};
export { callSummaryModel };
export { callClaude } from './summaryClaudeClient.js';
export { parsePrUrl, validatePrUrl, extractPrUrlIfNeeded, enrichPrData as _enrichPrData };
export { getChildSessions, buildChildSessionContext, aggregateFilesModified };
export { propagatePrUrlToParent };
export { hasSemanticSummaryChanged };

/**
 * Clear all pending CI-check timers (called during graceful shutdown).
 */
export function clearScheduledTimers() {
  for (const id of activeTimers) {
    clearTimeout(id);
  }
  activeTimers.clear();
}

// Read-only accessors for concurrency guard state
export const isGenerationActive = (key) => guard.isActive(key);
export const isRegenerationPending = (key) => guard.isPending(key);
