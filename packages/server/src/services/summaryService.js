/**
 * Summary Service - Lifecycle Orchestration
 * Debounce timer management, session summary generation, and delegation to sub-modules.
 * All heavy lifting is delegated to extracted modules.
 */

import { sessions, messages, conversations, sessionSummaries, projects, settings } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as ghService from './ghService.js';
import { agentCallLogger } from './agentCallLogger.js';
// Note: prStatusService is imported dynamically in onSessionComplete to avoid circular dependency

// --- Imports from extracted modules (used internally) ---
import { validatePrUrl as _validatePrUrl } from './prUrlValidator.js';
import { buildIncrementalPrompt as _buildIncrementalPrompt } from './summaryPromptBuilder.js';
import { callClaude as _callClaude, parseSummaryResponse as _parseSummaryResponse } from './summaryClaudeAdapter.js';
import { buildChildSessionContext as _buildChildSessionContext, aggregateFilesModified as _aggregateFilesModified, propagateToParent } from './sessionHierarchy.js';
import { isConversationSummaryEnabled, generateConversationSummary } from './conversationSummaryService.js';

// --- Re-exports from extracted modules (preserve public API) ---
export { extractPrUrlFromMessages, extractPrUrlIfNeeded } from './prUrlExtractor.js';
export { parsePrUrl, validatePrUrl } from './prUrlValidator.js';
export { DEFAULT_SESSION_TITLE_PROMPT, formatMessages, buildIncrementalPrompt } from './summaryPromptBuilder.js';
export { isMockMode, callClaude, parseSummaryResponse } from './summaryClaudeAdapter.js';
export { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './sessionHierarchy.js';
export { isConversationSummaryEnabled, generateConversationSummary } from './conversationSummaryService.js';

// Debounce timers per session
const debounceTimers = new Map();

// Debounce delay in milliseconds (30 seconds - optimized for token efficiency and responsiveness)
const DEBOUNCE_DELAY = 30000;

// Maximum number of recent messages to include in generation (optimized for token efficiency)
const MAX_MESSAGES = 15;

// Maximum retry attempts for failed parsing
const MAX_RETRIES = 2;

/**
 * Generate summary for a session using Claude Code SDK
 * @param {string} sessionId
 * @param {number} retryCount - Internal retry counter (do not set manually)
 * @param {boolean} force - Force generation even if summary is current (skips debounce/staleness check, default: false)
 * @param {boolean} userInitiated - Whether this was triggered by an explicit user action (e.g. clicking "regenerate" in the UI). When true, bypasses the global disable setting. (default: false)
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
      return null;
    }

    // Check if session summaries are disabled globally
    // Only user-initiated regeneration (explicit UI action) bypasses this check.
    // force=true (used by onSessionComplete) still respects the disable setting.
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

    if (recentMessages.length === 0) {
      console.warn(`[SummaryService] No messages found for session ${sessionId}`);
      return null;
    }

    // Broadcast that we're generating
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

    // Build child session context for workflow-aware summaries
    const childContext = _buildChildSessionContext(sessionId);

    // Build prompt with global title prompt and child context
    const prompt = _buildIncrementalPrompt(existingSummary, recentMessages, session.status, globalSettings?.sessionTitlePrompt, childContext);

    // Call Claude via SDK (or mock in test mode)
    const responseText = await _callClaude(prompt, recentMessages, session.status, {
      sessionId,
      callType: 'generateSessionSummary',
    });

    // Parse response
    const summaryData = _parseSummaryResponse(responseText);

    // Retry if parsing failed and we haven't exhausted retries
    if (summaryData._parseFailed && retryCount < MAX_RETRIES) {
      console.log(
        `[SummaryService] Parse failed for session ${sessionId}, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`
      );
      const backoffMs = 1000 * (retryCount + 1); // 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return generateSummary(sessionId, retryCount + 1, force, userInitiated);
    }

    // Clean up internal flag before saving
    delete summaryData._parseFailed;

    // Add message count for staleness tracking
    summaryData.messageCount = allMessages.length;

    // For root sessions (no parent), aggregate files from all child sessions
    if (!session.parentSessionId) {
      summaryData.filesModified = _aggregateFilesModified(sessionId, summaryData.filesModified);
    }

    // Validate and enrich PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
      // Validate PR URL against project repository
      const project = projects.getById(session.projectId);
      const projectRepoUrl = project?.repoUrl;
      const validation = _validatePrUrl(prUrl, projectRepoUrl);

      if (!validation.valid) {
        console.warn(`[SummaryService] PR URL validation failed for session ${sessionId}:`, validation.error);
        // Don't save the invalid PR URL
        summaryData.prUrl = null;
      } else {
        // Enrich with GitHub PR status if validation passed
        try {
          const prInfo = await ghService.getPrInfo(prUrl);
          if (prInfo) {
            summaryData.prState = prInfo.state;
            summaryData.prMerged = prInfo.merged;
            summaryData.hasMergeConflicts = prInfo.hasMergeConflicts;
            summaryData.ciStatus = prInfo.ciStatus;
            summaryData.ciFailures = prInfo.ciFailures;
          }
        } catch (error) {
          console.warn(`[SummaryService] Failed to get PR info for ${prUrl}:`, error.message);
        }
      }
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
      if (summaryData.sessionTitle) {
        updateData.name = summaryData.sessionTitle;
      }
      if (summaryData.prUrl) {
        updateData.prUrl = summaryData.prUrl;
      }
      const updatedSession = sessions.update(sessionId, updateData);

      // Broadcast session update for real-time UI sync (session detail view)
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        sessionId,
        session: updatedSession,
      });

      // Also broadcast to project subscribers for session list updates
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: updatedSession,
        });
      }
    }

    // Broadcast updated summary to session subscribers
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary,
    });

    // Also broadcast to project subscribers so session lists update in real-time
    if (session.projectId) {
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
        projectId: session.projectId,
        sessionId,
        summary,
      });
    }

    // Clear the generating flag so the UI knows generation is complete
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);

    // Propagate summary updates to parent sessions (workflow-aware)
    if (session.parentSessionId) {
      // Don't await - let this run asynchronously
      propagateToParent(sessionId, onSessionActivity);
    }

    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate summary for session ${sessionId}:`, {
      error: error.message,
      stack: error.stack,
      sessionId,
    });

    // Broadcast that generation stopped
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return null;
  }
}

/**
 * Called on every new message - debounces summary generation
 * @param {string} sessionId
 */
export function onSessionActivity(sessionId) {
  // Cancel existing timer
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
  }

  // Get project-specific debounce delay
  const session = sessions.getById(sessionId);
  if (!session) return;

  const project = projects.getById(session.projectId);
  const debounceDelay = project?.summaryDebounceMs || DEBOUNCE_DELAY;

  // Set new debounce timer with project-specific delay
  const timer = setTimeout(() => {
    generateSummary(sessionId);
    debounceTimers.delete(sessionId);
  }, debounceDelay);

  debounceTimers.set(sessionId, timer);
}

/**
 * Generate summary immediately and wait for completion (synchronous)
 * Used by template trigger to ensure summary is ready before creating new session
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummaryNow(sessionId) {
  // Cancel any pending debounced generation for this session
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }
  // Generate summary immediately and wait for completion
  return await generateSummary(sessionId);
}

/**
 * Called when session completes - generate immediately
 * Also schedules follow-up CI checks for sessions with PRs
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  // Cancel debounce timer if exists
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }

  // Generate summary immediately with force=true to update final state
  generateSummary(sessionId, 0, true);

  // Generate conversation summary for the active conversation
  if (isConversationSummaryEnabled(sessionId)) {
    const activeConversation = conversations.getActiveBySessionId(sessionId);
    if (activeConversation && !activeConversation.summary) {
      generateConversationSummary(sessionId, activeConversation.id).catch((err) => {
        console.error(`[SummaryService] Failed to generate conversation summary on session complete:`, err);
      });
    }
  }

  // Schedule follow-up CI checks for sessions with PRs
  // CI might still be running after the session completes
  const session = sessions.getById(sessionId);
  if (session?.prUrl) {
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
 * Check if a summary is stale (message count has changed)
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);
  return allMessages.length !== summary.messageCount;
}

/**
 * Clean up debounce timer for a session (call on session deletion)
 * @param {string} sessionId
 */
export function cleanupSession(sessionId) {
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }
}

/**
 * Propagate summary update to parent sessions
 * When a child session's summary is updated, the parent's summary may need regeneration
 * @param {string} sessionId - The child session ID that was updated
 */
export async function propagateToParentExported(sessionId) {
  propagateToParent(sessionId, onSessionActivity);
}

// Export constants for testing
export { DEBOUNCE_DELAY, MAX_MESSAGES, MAX_RETRIES };
