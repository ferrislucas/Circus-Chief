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
 * - summaryGenerate.js — core generation engine (private helpers)
 * - summarySessionComplete.js — session-completion lifecycle helpers
 */

import { sessions, sessionSummaries, settings } from '../database.js';
import { createConcurrencyGuard } from './withConcurrencyGuard.js';
import { isDescendantStateStale, isSummaryStale } from './summaryStaleCheck.js';
import { propagateToParent as _propagateToParent } from './summaryPropagation.js';
import { buildMergedParentSummary } from './summaryMerge.js';
import { saveManualSummary as _saveManualSummary } from './summaryManualSave.js';
import { _doGenerateSummary } from './summaryGenerate.js';
import { tryLightweightOutcomeUpdate, scheduleCiChecks } from './summarySessionComplete.js';

// Note: prStatusService is imported dynamically in summarySessionComplete to avoid circular dependency

// Create the concurrency guard instance for summary generation
const guard = createConcurrencyGuard();

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
 * If summary exists but is stale, regenerate it (unless summaries are disabled).
 * Returns the regenerated summary, or null if not regenerated.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
async function _regenerateSummaryIfStale(sessionId) {
  if (!isSummaryStale(sessionId)) return null;
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) return null;
  return generateSummary(sessionId);
}

/**
 * Get summary for a session, generating if needed
 * @param {string} sessionId
 * @param {boolean} generateIfMissing
 * @returns {Promise<Object|null>}
 */
export async function getSummary(sessionId, generateIfMissing = false) {
  let summary = sessionSummaries.getBySessionId(sessionId);
  let justGenerated = false;

  if (!summary && generateIfMissing) {
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) return null;
    summary = await generateSummary(sessionId);
    justGenerated = true;
  }

  if (summary && !justGenerated && generateIfMissing) {
    const refreshed = await _regenerateSummaryIfStale(sessionId);
    if (refreshed) { summary = refreshed; justGenerated = true; }
  }

  // Repair stale descendant projections via cheap deterministic merge (no LLM call).
  // Skip if we just ran generateSummary, which already merges descendants.
  // Only repair when the caller opts in to freshness (generateIfMissing=true) to
  // prevent write-on-read side-effects for callers that just want to read the summary.
  if (summary && !justGenerated && generateIfMissing && isDescendantStateStale(sessionId, summary)) {
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
  return _saveManualSummary(sessionId, data);
}

/**
 * Propagate summary update to all ancestor sessions using deterministic merge.
 * Delegates to summaryPropagation module (no LLM call, no token cost).
 * @param {string} sessionId
 */
export function propagateToParent(sessionId) {
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

// Re-exports from sub-modules for backward compatibility
export {
  MAX_MESSAGES, MIN_MESSAGES_FOR_SUMMARY, MAX_RETRIES, DEFAULT_SESSION_TITLE_PROMPT,
  SUMMARY_SYSTEM_PROMPT, formatMessages, buildIncrementalPrompt, parseSummaryResponse,
  stripMarkdownCodeBlock as _stripMarkdownCodeBlock, trackMessageMetadata as _trackMessageMetadata,
} from './summaryPrompts.js';
export { updateSessionFromSummary as _updateSessionFromSummary } from './summaryGenerate.js';
export { callSummaryModel } from './summaryModelClient.js';
export { callClaude } from './summaryClaudeClient.js';
export { parsePrUrl, validatePrUrl, extractPrUrlIfNeeded, enrichPrData as _enrichPrData } from './prUrlService.js';
export { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './childSessionContext.js';
export { propagatePrUrlToParent } from './summaryPropagation.js';
export { hasSemanticSummaryChanged } from './summaryFingerprint.js';
export { clearScheduledTimers } from './summarySessionComplete.js';

// Read-only accessors for concurrency guard state
export const isGenerationActive = (key) => guard.isActive(key);
export const isRegenerationPending = (key) => guard.isPending(key);
