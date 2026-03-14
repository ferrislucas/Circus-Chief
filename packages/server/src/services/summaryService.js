/**
 * Session summary orchestration service.
 *
 * Coordinates summary generation, staleness detection, lifecycle hooks,
 * and concurrency management. Delegates to extracted modules:
 * - summaryClaudeClient.js — Claude SDK interaction
 * - summaryPrompts.js — prompt templates, parsing, formatting
 * - prUrlService.js — PR URL extraction, validation, enrichment
 * - childSessionContext.js — child session hierarchy and file aggregation
 * - conversationSummary.js — conversation-specific summary generation
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
  CONVERSATION_SUMMARY_SYSTEM_PROMPT,
  COMBINED_SUMMARY_SYSTEM_PROMPT,
  formatMessages,
  buildIncrementalPrompt,
  parseSummaryResponse,
  trackMessageMetadata,
  stripMarkdownCodeBlock,
} from './summaryPrompts.js';
import { extractPrUrlIfNeeded, parsePrUrl, validatePrUrl, enrichPrData } from './prUrlService.js';
import { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './childSessionContext.js';
import { isConversationSummaryEnabled, generateConversationSummary, doGenerateSessionAndConversationSummary } from './conversationSummary.js';
import { broadcastSummaryUpdate, broadcastGeneratingStatus, broadcastSessionUpdate } from './summaryBroadcast.js';

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
 * Internal implementation of generateSummary (called by concurrency guard wrapper)
 * @param {string} sessionId
 * @param {number} retryCount
 * @param {boolean} force
 * @param {boolean} userInitiated
 * @returns {Promise<Object|null>}
 */
async function _doGenerateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
      return null;
    }

    // Check if session summaries are disabled globally
    // Only user-initiated regeneration bypasses this check.
    const globalSettings = settings.getSummarySettings();
    if (!userInitiated && globalSettings?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled globally, skipping generation`);
      return null;
    }

    // Get existing summary for incremental generation
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Skip regeneration for merged PRs (work is complete)
    if (existingSummary?.prMerged) {
      console.log(`[SummaryService] Session ${sessionId} has merged PR, skipping regeneration`);
      return existingSummary;
    }

    // Get recent messages
    const allMessages = messages.getBySessionId(sessionId);

    // Skip if summary is current and not forced to regenerate
    if (!force && !isSummaryStale(sessionId)) {
      console.log(`[SummaryService] Summary for ${sessionId} is current, skipping regeneration`);
      return existingSummary;
    }
    const recentMessages = allMessages.slice(-MAX_MESSAGES);

    // Broadcast that we're generating (do this early so UI always gets the event)
    broadcastGeneratingStatus(sessionId, true);

    // Handle sessions with too few messages - create a minimal summary instead of skipping
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      console.log(`[SummaryService] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), creating minimal summary`);

      const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;

      // Create a minimal summary based on available messages
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

      // Broadcast the minimal summary
      broadcastSummaryUpdate(sessionId, session.projectId, summary);

      // Also broadcast session:updated to project subscribers so session lists update
      if (session.projectId) {
        broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
      }

      // Clear the generating flag
      broadcastGeneratingStatus(sessionId, false);

      return summary;
    }

    // Build child session context for workflow-aware summaries
    const childContext = buildChildSessionContext(sessionId);

    // Build prompt with global title prompt and child context
    const prompt = buildIncrementalPrompt(existingSummary, recentMessages, session.status, globalSettings?.sessionTitlePrompt, childContext);

    // Call Claude via SDK
    const responseText = await callClaude(prompt, recentMessages, session.status, {
      sessionId,
      callType: 'generateSessionSummary',
    }, SUMMARY_SYSTEM_PROMPT);

    // Parse response
    const summaryData = parseSummaryResponse(responseText);

    // Retry if parsing failed and we haven't exhausted retries
    if (summaryData._parseFailed && retryCount < MAX_RETRIES) {
      console.log(
        `[SummaryService] Parse failed for session ${sessionId}, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`
      );
      const backoffMs = 1000 * (retryCount + 1); // 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return _doGenerateSummary(sessionId, retryCount + 1, force, userInitiated);
    }

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
    const project = projects.getById(session.projectId);
    if (!project.repoUrl && (summaryData.prUrl || summaryData.repositoryUrl)) {
      let extractedRepoUrl = summaryData.repositoryUrl;

      // If we have a PR URL, extract the repository base URL
      if (!extractedRepoUrl && summaryData.prUrl) {
        const prMatch = summaryData.prUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/|$)/);
        if (prMatch) {
          extractedRepoUrl = prMatch[1];
        }
      }

      // Update project with the extracted repo URL if valid
      if (extractedRepoUrl) {
        try {
          projects.update(session.projectId, { repoUrl: extractedRepoUrl });
          console.log(`[SummaryService] Auto-populated repo URL for project ${session.projectId}: ${extractedRepoUrl}`);
        } catch (error) {
          console.warn(`[SummaryService] Failed to auto-populate repo URL for project ${session.projectId}:`, error.message);
        }
      }
    }

    // Update session name and prUrl if we have new data
    if (summaryData.sessionTitle || summaryData.prUrl) {
      const updateData = {};

      // Re-fetch the session to check the manuallyNamed flag
      const freshSession = sessions.getById(sessionId);

      // Only update name if session is not manually named
      if (summaryData.sessionTitle && !freshSession.manuallyNamed) {
        updateData.name = summaryData.sessionTitle;
      }

      // PR URL updates are always allowed (regardless of manuallyNamed)
      if (summaryData.prUrl) {
        updateData.prUrl = summaryData.prUrl;
      }

      const updatedSession = sessions.update(sessionId, updateData);

      // Propagate PR URL to parent session
      if (summaryData.prUrl) {
        propagatePrUrlToParent(sessionId, summaryData.prUrl);
      }

      // Broadcast session update for real-time UI sync
      broadcastSessionUpdate(sessionId, session.projectId, updatedSession);
    } else {
      // Even if name/PR URL didn't change, broadcast so project subscribers know summary was generated
      if (session.projectId) {
        broadcastSessionUpdate(sessionId, session.projectId, sessions.getById(sessionId));
      }
    }

    // Broadcast updated summary to session and project subscribers
    broadcastSummaryUpdate(sessionId, session.projectId, summary);

    // Clear the generating flag so the UI knows generation is complete
    broadcastGeneratingStatus(sessionId, false);

    console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);

    // Propagate summary updates to parent sessions (workflow-aware)
    if (session.parentSessionId) {
      // Don't await - let this run asynchronously
      propagateToParent(sessionId);
    }

    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate summary for session ${sessionId}:`, {
      error: error.message,
      stack: error.stack,
      sessionId,
    });

    // Broadcast that generation stopped
    broadcastGeneratingStatus(sessionId, false);

    return null;
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
  return await generateSummary(sessionId);
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
 * Called when session completes - generate immediately if summary is stale,
 * otherwise do a lightweight outcome-only DB update (no LLM call).
 * Also schedules follow-up CI checks for sessions with PRs.
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  // Lightweight outcome update: if summary exists and is current,
  // just update the outcome field without calling the LLM
  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  const session = sessions.getById(sessionId);
  if (existingSummary && !isSummaryStale(sessionId) && session) {
    const newOutcome = session.status === 'error' ? 'failed'
      : session.status === 'stopped' ? 'partial'
      : 'completed';
    if (existingSummary.outcome !== newOutcome) {
      sessionSummaries.upsert(sessionId, { ...existingSummary, outcome: newOutcome });
      console.log(`[SummaryService] Lightweight outcome update for session ${sessionId}: ${existingSummary.outcome} -> ${newOutcome}`);

      // Broadcast the updated summary
      const updatedSummary = sessionSummaries.getBySessionId(sessionId);
      broadcastSummaryUpdate(sessionId, session.projectId, updatedSummary);
    } else {
      console.log(`[SummaryService] Summary for session ${sessionId} is current and outcome unchanged, skipping generation`);
    }
    // Still schedule CI checks below
  } else {
    // Summary is stale or doesn't exist -- generate via LLM
    const globalSettings = settings.getSummarySettings();
    if (!globalSettings?.disableSessionSummaries) {
      generateSummary(sessionId);
    }
  }

  // Schedule follow-up CI checks for sessions with PRs
  const sessionForCi = session || sessions.getById(sessionId);
  if (sessionForCi?.prUrl) {
    // Use dynamic import to avoid circular dependency with prStatusService
    const scheduleCiCheck = async () => {
      const prStatusService = await import('./prStatusService.js');
      prStatusService.checkSessionCiStatusNow(sessionId);
    };

    // Check after 2 minutes (CI often takes a few minutes)
    setTimeout(scheduleCiCheck, 2 * 60 * 1000);

    // Check again after 5 minutes
    setTimeout(scheduleCiCheck, 5 * 60 * 1000);
  }
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

/**
 * Check if a summary is stale (message count or last message ID has changed)
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);

  // Use message ID-based staleness detection if available
  if (summary.lastSummarizedMessageId) {
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastMessageId = lastMessage ? lastMessage.id : null;

    // Summary is stale if the last message ID doesn't match
    if (lastMessageId !== summary.lastSummarizedMessageId) {
      return true;
    }

    // Also validate count as a secondary check (defensive programming)
    return allMessages.length !== summary.messageCount;
  }

  // Fallback to count-based staleness detection for old summaries
  return allMessages.length !== summary.messageCount;
}

/**
 * Clean up any in-flight state for a session (call on session deletion)
 * @param {string} sessionId
 */
export function cleanupSession(sessionId) {
  guard.cleanup(sessionId);
}

/**
 * Generate both session and conversation summaries in a single API call (with concurrency guard)
 * @param {string} sessionId - The session ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} Object with sessionSummary and conversationSummary
 */
export async function generateSessionAndConversationSummary(sessionId, conversationId) {
  return guard.run(
    sessionId,
    () => doGenerateSessionAndConversationSummary(sessionId, conversationId, generateSummary),
    {
      onFollowUp: (key) => generateSummary(key),
    }
  );
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
  CONVERSATION_SUMMARY_SYSTEM_PROMPT,
  COMBINED_SUMMARY_SYSTEM_PROMPT,
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

// From conversationSummary.js
export { isConversationSummaryEnabled, generateConversationSummary };

// Expose concurrency guard state for tests
const activeGenerations = guard.activeGenerations;
const pendingRegenerations = guard.pendingRegenerations;
export { activeGenerations, pendingRegenerations };
