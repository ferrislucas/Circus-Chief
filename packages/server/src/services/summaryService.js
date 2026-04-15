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
 */

import { sessions, messages, sessionSummaries, projects, settings } from '../database.js';
import { createConcurrencyGuard } from './withConcurrencyGuard.js';
import { callClaude } from './summaryClaudeClient.js';
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
import { isSummaryStale } from './summaryStaleCheck.js';

// Note: prStatusService is imported dynamically in onSessionComplete to avoid circular dependency

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
 * Returns an object with the decision and any data needed downstream.
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
 * Fetch conversation context: build child session context and the prompt for Claude.
 * @param {string} sessionId
 * @param {Object} context
 * @param {Object|null} context.existingSummary
 * @param {Array} context.recentMessages
 * @param {Object} context.session
 * @param {Object} context.globalSettings
 * @returns {{ prompt: string, childContext: Object }}
 */
function fetchConversationContext(sessionId, { existingSummary, recentMessages, session, globalSettings }) {
  const childContext = buildChildSessionContext(sessionId);
  const prompt = buildIncrementalPrompt(existingSummary, recentMessages, session.status, {
    projectTitlePrompt: globalSettings?.sessionTitlePrompt,
    childContext,
  });
  return { prompt, childContext };
}

/**
 * Persist the generated summary and broadcast all related updates.
 * Handles: metadata tracking, file aggregation, PR enrichment, upsert,
 * project repo auto-population, session name/prUrl update, and broadcasts.
 * @param {string} sessionId
 * @param {Object} summaryDataInput - parsed summary data (mutated in place)
 * @param {Object} session
 * @param {Array} allMessages
 * @returns {Promise<Object>} the persisted summary record
 */
async function saveSummaryResult(sessionId, summaryDataInput, session, allMessages) {
  const summaryData = summaryDataInput;
  // Clean up internal flag before saving
  delete summaryData._parseFailed;

  // Add message count and last message ID for staleness tracking
  trackMessageMetadata(summaryData, allMessages);

  // For root sessions (no parent), aggregate files from all child sessions
  if (!session.parentSessionId) {
    summaryData.filesModified = aggregateFilesModified(sessionId, summaryData.filesModified);
  }

  // Validate and enrich PR URL
  const prUrl = summaryData.prUrl || session.prUrl;
  if (prUrl) {
    const project = projects.getById(session.projectId);
    await enrichPrData(summaryData, prUrl, project?.repoUrl, sessionId);
  }

  // Upsert summary
  const summary = sessionSummaries.upsert(sessionId, summaryData);

  // Auto-populate project repo URL if not already set
  autoPopulateProjectRepoUrl(session, summaryData);

  // Update session name and prUrl, then broadcast
  updateSessionFromSummary(sessionId, session, summaryData);

  // Broadcast updated summary to session and project subscribers
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
    if (prMatch) {
      extractedRepoUrl = prMatch[1];
    }
  }

  if (extractedRepoUrl) {
    try {
      projects.update(session.projectId, { repoUrl: extractedRepoUrl });
      console.log(`[SummaryService] Auto-populated repo URL for project ${session.projectId}: ${extractedRepoUrl}`);
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

    if (summaryData.sessionTitle && !freshSession.manuallyNamed) {
      updateData.name = summaryData.sessionTitle;
    }

    if (summaryData.prUrl) {
      updateData.prUrl = summaryData.prUrl;
    }

    const updatedSession = sessions.update(sessionId, updateData);

    if (summaryData.prUrl) {
      propagatePrUrlToParent(sessionId, summaryData.prUrl);
    }

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
  console.log(`[SummaryService] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), creating minimal summary`);

  const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;

  const minimalSummary = {
    shortSummary: 'Session in progress',
    fullSummary: `Session with ${allMessages.length} message${allMessages.length !== 1 ? 's' : ''}`,
    keyActions: [],
    filesModified: [],
    outcome: session.status === 'stopped' ? 'partial' : session.status === 'error' ? 'failed' : 'ongoing',
    messageCount: allMessages.length,
    lastSummarizedMessageId: lastMessage ? lastMessage.id : null,
  };

  const summary = sessionSummaries.upsert(sessionId, minimalSummary);

  broadcastSummaryUpdate(sessionId, session.projectId, summary);

  if (session.projectId) {
    broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
  }

  return summary;
}

/**
 * Retry summary generation if parsing failed and retries remain.
 * Returns { shouldRetry: true, result } if a retry was performed,
 * or { shouldRetry: false } if no retry is needed.
 * @param {Object} summaryData - Parsed summary data (may have _parseFailed flag)
 * @param {number} retryCount - Current retry count
 * @param {string} sessionId
 * @param {boolean} force
 * @param {boolean} userInitiated
 * @returns {Promise<{ shouldRetry: boolean, result?: Object|null }>}
 */
async function retryIfParseFailed(summaryData, retryCount, { sessionId, force, userInitiated }) {
  if (!summaryData._parseFailed || retryCount >= MAX_RETRIES) {
    return { shouldRetry: false };
  }

  console.log(
    `[SummaryService] Parse failed for session ${sessionId}, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`
  );
  const backoffMs = 1000 * (retryCount + 1);
  await new Promise((resolve) => setTimeout(resolve, backoffMs));
  const result = await _doGenerateSummary(sessionId, retryCount + 1, force, userInitiated);
  return { shouldRetry: true, result };
}

async function _doGenerateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  // Early-exit checks
  const check = shouldGenerateSummary(sessionId, force, userInitiated);
  if (check.skip) return check.result;

  const { session, globalSettings, existingSummary, allMessages } = check;
  const recentMessages = allMessages.slice(-MAX_MESSAGES);

  // Broadcast that we're generating (do this early so UI always gets the event)
  broadcastGeneratingStatus(sessionId, true);

  try {
    // Handle sessions with too few messages
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      return createMinimalSummary(sessionId, session, allMessages);
    }

    // Build conversation context and prompt
    const { prompt } = fetchConversationContext(sessionId, { existingSummary, recentMessages, session, globalSettings });

    // Call Claude via SDK
    const responseText = await callClaude(prompt, recentMessages, session.status, {
      logMeta: { sessionId, callType: 'generateSessionSummary' },
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
    });

    // Parse response and retry if needed
    const summaryData = parseSummaryResponse(responseText);
    const retryResult = await retryIfParseFailed(summaryData, retryCount, { sessionId, force, userInitiated });
    if (retryResult.shouldRetry) return retryResult.result;

    // Persist summary and broadcast updates
    const summary = await saveSummaryResult(sessionId, summaryData, session, allMessages);

    console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);

    // Propagate summary updates to parent sessions (workflow-aware)
    if (session.parentSessionId) {
      propagateToParent(sessionId);
    }

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
 * Used by template trigger to ensure summary is ready before creating new session
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummaryNow(sessionId) {
  // Check if session summaries are disabled globally (early exit before concurrency bookkeeping)
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) {
    return null;
  }
  // Generate summary immediately and wait for completion
  return generateSummary(sessionId);
}

/**
 * Trigger summary generation on session activity (e.g., turn completion).
 * @param {string} sessionId
 */
export function onSessionActivity(sessionId) {
  // Early exit if session summaries are disabled globally
  const globalSettings = settings.getSummarySettings();
  if (globalSettings?.disableSessionSummaries) {
    return;
  }

  generateSummary(sessionId).catch((err) => {
    console.error(`[SummaryService] Failed to generate summary on activity for session ${sessionId}:`, err);
  });
}

/**
 * Schedule CI status checks for a session with a PR.
 * Uses dynamic import to avoid circular dependency.
 * @param {string} sessionId
 */
function scheduleCiChecks(sessionId) {
  const scheduleCiCheck = async () => {
    const prStatusService = await import('./prStatusService.js');
    prStatusService.checkSessionCiStatusNow(sessionId);
  };
  // Check after 2 minutes (CI often takes a few minutes)
  setTimeout(scheduleCiCheck, 2 * 60 * 1000);
  // Check again after 5 minutes
  setTimeout(scheduleCiCheck, 5 * 60 * 1000);
}

/**
 * Map session status to summary outcome.
 * @param {string} status - Session status
 * @returns {'failed'|'partial'|'completed'}
 */
function statusToOutcome(status) {
  if (status === 'error') return 'failed';
  if (status === 'stopped') return 'partial';
  return 'completed';
}

/**
 * Perform lightweight outcome-only update for a current summary.
 * Returns true if handled (outcome unchanged or updated), false if summary generation needed.
 * @param {string} sessionId
 * @param {Object} existingSummary
 * @param {Object} session
 * @returns {boolean}
 */
function tryLightweightOutcomeUpdate(sessionId, existingSummary, session) {
  if (!existingSummary || isSummaryStale(sessionId) || !session) {
    return false;
  }

  const newOutcome = statusToOutcome(session.status);
  if (existingSummary.outcome === newOutcome) {
    console.log(`[SummaryService] Summary for session ${sessionId} is current and outcome unchanged, skipping generation`);
    return true;
  }

  sessionSummaries.upsert(sessionId, { ...existingSummary, outcome: newOutcome });
  console.log(`[SummaryService] Lightweight outcome update for session ${sessionId}: ${existingSummary.outcome} -> ${newOutcome}`);

  const updatedSummary = sessionSummaries.getBySessionId(sessionId);
  broadcastSummaryUpdate(sessionId, session.projectId, updatedSummary);
  return true;
}

/**
 * Called when session completes - generate immediately if summary is stale,
 * otherwise do a lightweight outcome-only DB update (no LLM call).
 * Also schedules follow-up CI checks for sessions with PRs.
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  const globalSettings = settings.getSummarySettings();
  const session = sessions.getById(sessionId);

  // Schedule CI checks if session has a PR (always, regardless of summary settings)
  if (session?.prUrl) {
    scheduleCiChecks(sessionId);
  }

  // Early exit if session summaries are disabled globally
  if (globalSettings?.disableSessionSummaries) {
    return;
  }

  // Try lightweight outcome update first
  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  if (tryLightweightOutcomeUpdate(sessionId, existingSummary, session)) {
    return;
  }

  // Summary is stale or doesn't exist -- generate via LLM
  generateSummary(sessionId);
}

/**
 * Get summary for a session, generating if needed
 * @param {string} sessionId
 * @param {boolean} generateIfMissing - Whether to generate if no summary exists
 * @returns {Promise<Object|null>}
 */
export async function getSummary(sessionId, generateIfMissing = false) {
  let summary = sessionSummaries.getBySessionId(sessionId);

  if (!summary && generateIfMissing) {
    // Don't generate if session summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) return null;
    summary = await generateSummary(sessionId);
  }

  return summary;
}

/**
 * Force regenerate summary for a session (user-initiated action)
 * This bypasses the global disable setting since the user explicitly requested it.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function regenerateSummary(sessionId) {
  return generateSummary(sessionId, 0, true, true);
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

/**
 * Propagate summary update to parent sessions
 * @param {string} sessionId - The child session ID that was updated
 */
export async function propagateToParent(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.parentSessionId) return;

  generateSummary(session.parentSessionId);
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
  if (!session || !session.parentSessionId) return; // already root or orphan

  const rootId = sessions.getRootSessionId(sessionId);
  if (!rootId || rootId === sessionId) return;

  const root = sessions.getById(rootId);
  if (!root || root.prUrl) return; // Don't overwrite existing PR URL

  sessions.update(root.id, { prUrl });

  // Broadcast updates
  broadcastSessionUpdate(root.id, root.projectId, sessions.getById(root.id));

  console.log(`[SummaryService] Propagated PR URL from session ${sessionId} to root ${root.id}: ${prUrl}`);
}

// Re-export from extracted modules for backward compatibility
// These are used by external consumers and tests
export {
  // From summaryPrompts.js
  MAX_MESSAGES,
  MIN_MESSAGES_FOR_SUMMARY,
  MAX_RETRIES,
  DEFAULT_SESSION_TITLE_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  formatMessages,
  buildIncrementalPrompt,
  parseSummaryResponse,
  stripMarkdownCodeBlock as _stripMarkdownCodeBlock,
  trackMessageMetadata as _trackMessageMetadata,
};

// From summaryClaudeClient.js
export { callClaude };

// From prUrlService.js
export { parsePrUrl, validatePrUrl, extractPrUrlIfNeeded, enrichPrData as _enrichPrData };

// From childSessionContext.js
export { getChildSessions, buildChildSessionContext, aggregateFilesModified };

// Read-only accessors for concurrency guard state
export const isGenerationActive = (key) => guard.isActive(key);
export const isRegenerationPending = (key) => guard.isPending(key);
