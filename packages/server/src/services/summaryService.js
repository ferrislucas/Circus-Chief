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
import { buildIncrementalPrompt as _buildIncrementalPrompt, SUMMARY_SYSTEM_PROMPT, COMBINED_SUMMARY_SYSTEM_PROMPT, formatMessages as _formatMessages, DEFAULT_SESSION_TITLE_PROMPT as _DEFAULT_SESSION_TITLE_PROMPT } from './summaryPromptBuilder.js';
import { callClaude as _callClaude, parseSummaryResponse as _parseSummaryResponse, isMockMode as _isMockMode } from './summaryClaudeAdapter.js';
import { buildChildSessionContext as _buildChildSessionContext, aggregateFilesModified as _aggregateFilesModified, propagateToParent } from './sessionHierarchy.js';
import { isConversationSummaryEnabled, generateConversationSummary } from './conversationSummaryService.js';

// --- Re-exports from extracted modules (preserve public API) ---
export { extractPrUrlFromMessages, extractPrUrlIfNeeded } from './prUrlExtractor.js';
export { parsePrUrl, validatePrUrl } from './prUrlValidator.js';
export { DEFAULT_SESSION_TITLE_PROMPT, formatMessages, buildIncrementalPrompt, SUMMARY_SYSTEM_PROMPT, CONVERSATION_SUMMARY_SYSTEM_PROMPT, COMBINED_SUMMARY_SYSTEM_PROMPT } from './summaryPromptBuilder.js';
export { isMockMode, callClaude, parseSummaryResponse } from './summaryClaudeAdapter.js';
export { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './sessionHierarchy.js';
export { isConversationSummaryEnabled, generateConversationSummary } from './conversationSummaryService.js';

// Debounce timers per session
const debounceTimers = new Map();

// Concurrency guard: tracks in-flight generation promises per session
const activeGenerations = new Map(); // sessionId -> Promise
const pendingRegenerations = new Set(); // sessionIds that need regeneration after current completes

// Debounce delay in milliseconds (60 seconds - optimized for token efficiency and responsiveness)
const DEBOUNCE_DELAY = 60000;

// Minimum number of messages before generating a summary (skip trivial sessions)
const MIN_MESSAGES_FOR_SUMMARY = 3;

// Maximum number of recent messages to include in generation (optimized for token efficiency)
const MAX_MESSAGES = 10;

// Maximum retry attempts for failed parsing
const MAX_RETRIES = 2;

/**
 * Generate summary for a session using Claude Code SDK (with concurrency guard)
 * Only one generation can be in-flight per session at a time. If a generation is already
 * running, the call is coalesced and a single follow-up generation is scheduled after completion.
 * @param {string} sessionId
 * @param {number} retryCount - Internal retry counter (do not set manually)
 * @param {boolean} force - Force generation even if summary is current (skips debounce/staleness check, default: false)
 * @param {boolean} userInitiated - Whether this was triggered by an explicit user action (e.g. clicking "regenerate" in the UI). When true, bypasses the global disable setting and concurrency guard. (default: false)
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  // Concurrency guard: if a generation is already in-flight for this session,
  // queue a single follow-up instead of running concurrently
  if (activeGenerations.has(sessionId) && !userInitiated) {
    pendingRegenerations.add(sessionId);
    return activeGenerations.get(sessionId);
  }

  const promise = _doGenerateSummary(sessionId, retryCount, force, userInitiated);
  activeGenerations.set(sessionId, promise);

  try {
    return await promise;
  } finally {
    activeGenerations.delete(sessionId);
    if (pendingRegenerations.has(sessionId)) {
      pendingRegenerations.delete(sessionId);
      // Use debounced path for follow-up, not immediate generation
      onSessionActivity(sessionId);
    }
  }
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

    // Broadcast that we're generating (do this early so UI always gets the event)
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

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
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
        sessionId,
        summary,
      });

      // Also broadcast to project subscribers
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
          projectId: session.projectId,
          sessionId,
          summary,
        });

        // Also broadcast session:updated to project subscribers so session lists update
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: sessions.getById(sessionId),
        });
      }

      // Clear the generating flag
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
        sessionId,
        generating: false,
      });

      return summary;
    }

    // Build child session context for workflow-aware summaries
    const childContext = _buildChildSessionContext(sessionId);

    // Build prompt with global title prompt and child context
    const prompt = _buildIncrementalPrompt(existingSummary, recentMessages, session.status, globalSettings?.sessionTitlePrompt, childContext);

    // Call Claude via SDK (or mock in test mode)
    const responseText = await _callClaude(prompt, recentMessages, session.status, {
      sessionId,
      callType: 'generateSessionSummary',
    }, SUMMARY_SYSTEM_PROMPT);

    // Parse response
    const summaryData = _parseSummaryResponse(responseText);

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

    // Add message count and last message ID for staleness tracking (Phase 6)
    summaryData.messageCount = allMessages.length;
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    summaryData.lastSummarizedMessageId = lastMessage ? lastMessage.id : null;

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
    } else {
      // Even if name/PR URL didn't change, broadcast SESSION_UPDATED so project subscribers know summary was generated
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
          projectId: session.projectId,
          sessionId,
          session: sessions.getById(sessionId),
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
 * Called when session completes - generate immediately if summary is stale,
 * otherwise do a lightweight outcome-only DB update (no LLM call).
 * Also schedules follow-up CI checks for sessions with PRs.
 * @param {string} sessionId
 */
export function onSessionComplete(sessionId) {
  // Cancel debounce timer if exists
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }

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
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
        sessionId,
        summary: updatedSummary,
      });
      if (session.projectId) {
        broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
          projectId: session.projectId,
          sessionId,
          summary: updatedSummary,
        });
      }
    } else {
      console.log(`[SummaryService] Summary for session ${sessionId} is current and outcome unchanged, skipping generation`);
    }
    // Still schedule CI checks below
  } else {
    // Summary is stale or doesn't exist -- generate via LLM
    // Check if we should use combined generation (more efficient - one API call instead of two)
    const activeConversation = conversations.getActiveBySessionId(sessionId);
    const shouldGenConvSummary = activeConversation && !activeConversation.summary && isConversationSummaryEnabled(sessionId);

    if (shouldGenConvSummary) {
      // Use combined generation - single API call for both summaries (no force=true)
      generateSessionAndConversationSummary(sessionId, activeConversation.id).catch((err) => {
        console.error(`[SummaryService] Failed to generate combined summary on session complete:`, err);
        // Fallback to individual generations if combined fails (no force=true)
        generateSummary(sessionId);
        if (activeConversation) {
          generateConversationSummary(sessionId, activeConversation.id).catch((err2) => {
            console.error(`[SummaryService] Failed fallback conversation summary:`, err2);
          });
        }
      });
    } else {
      // Only generate session summary (no force=true -- staleness check will determine if needed)
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
 * Phase 6: Enhanced staleness detection using both message count and message ID
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSummaryStale(sessionId) {
  const summary = sessionSummaries.getBySessionId(sessionId);
  if (!summary) return true;

  const allMessages = messages.getBySessionId(sessionId);

  // Phase 6: Use message ID-based staleness detection if available
  if (summary.lastSummarizedMessageId) {
    // Get the last message ID from the session
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
 * Generate both session and conversation summaries in a single API call (with concurrency guard)
 * This is more efficient than calling them separately.
 * Shares the same concurrency guard as generateSummary to prevent overlapping generation.
 * @param {string} sessionId - The session ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} Object with sessionSummary and conversationSummary
 */
export async function generateSessionAndConversationSummary(sessionId, conversationId) {
  // Concurrency guard: if a generation is already in-flight for this session,
  // queue a single follow-up instead of running concurrently
  if (activeGenerations.has(sessionId)) {
    pendingRegenerations.add(sessionId);
    return activeGenerations.get(sessionId);
  }

  const promise = _doGenerateSessionAndConversationSummary(sessionId, conversationId);
  activeGenerations.set(sessionId, promise);

  try {
    return await promise;
  } finally {
    activeGenerations.delete(sessionId);
    if (pendingRegenerations.has(sessionId)) {
      pendingRegenerations.delete(sessionId);
      onSessionActivity(sessionId);
    }
  }
}

/**
 * Internal implementation of generateSessionAndConversationSummary (called by concurrency guard wrapper)
 * @param {string} sessionId
 * @param {string} conversationId
 * @returns {Promise<Object>}
 */
async function _doGenerateSessionAndConversationSummary(sessionId, conversationId) {
  try {
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for combined summary generation`);
      return { sessionSummary: null, conversationSummary: null };
    }

    const conversation = conversations.getById(conversationId);
    if (!conversation || conversation.sessionId !== sessionId) {
      console.warn(`[SummaryService] Conversation ${conversationId} not found for session ${sessionId}`);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Check if session summaries are disabled globally
    const globalSettings = settings.getSummarySettings();
    if (globalSettings?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled globally, skipping combined generation`);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Get existing session summary and recent messages
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Staleness check: skip combined generation if summary is current
    if (!isSummaryStale(sessionId)) {
      console.log(`[SummaryService] Summary for ${sessionId} is current, skipping combined generation`);
      return { sessionSummary: existingSummary, conversationSummary: null };
    }

    const allMessages = messages.getBySessionId(sessionId);
    const conversationMessages = messages.getByConversationId(conversationId);

    // Check minimum message threshold
    if (allMessages.length < MIN_MESSAGES_FOR_SUMMARY) {
      console.log(
        `[SummaryService] Session ${sessionId} has only ${allMessages.length} messages (minimum ${MIN_MESSAGES_FOR_SUMMARY}), skipping combined summary generation`
      );
      return { sessionSummary: null, conversationSummary: null };
    }

    // Get recent messages for session summary
    const recentMessages = allMessages.slice(-MAX_MESSAGES);

    // Broadcast that we're generating
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

    // Build child session context
    const childContext = _buildChildSessionContext(sessionId);

    // Build existing summary context
    const existingContext = existingSummary
      ? `EXISTING SESSION SUMMARY:
${existingSummary.fullSummary}

Key actions so far: ${JSON.stringify(existingSummary.keyActions || [])}
Files modified: ${JSON.stringify(existingSummary.filesModified || [])}
Previous outcome: ${existingSummary.outcome}
Previous title: ${existingSummary.sessionTitle || 'Not set'}`
      : 'EXISTING SESSION SUMMARY:\nNo previous summary - this is the first generation.';

    // Build combined prompt with both session and conversation context
    const formattedSessionMessages = _formatMessages(recentMessages);
    const formattedConversationMessages = _formatMessages(conversationMessages);

    const combinedPrompt = `Current session status: ${session.status}

${existingContext}
${childContext}
RECENT SESSION CONVERSATION:
${formattedSessionMessages}

ACTIVE CONVERSATION THREAD:
${formattedConversationMessages}

Session title guidelines:
${globalSettings?.sessionTitlePrompt || _DEFAULT_SESSION_TITLE_PROMPT}`;

    // Combined JSON schema with both session and conversation summary fields
    const combinedSchema = {
      type: 'object',
      properties: {
        // Session summary fields
        short_summary: { type: 'string', description: '1-2 sentence preview for list view (max 150 characters)' },
        full_summary: { type: 'string', description: 'Detailed summary with key accomplishments (max 500 characters)' },
        key_actions: { type: 'array', items: { type: 'string' }, description: 'List of key actions taken' },
        files_modified: { type: 'array', items: { type: 'string' }, description: 'List of files modified' },
        outcome: { type: 'string', enum: ['completed', 'partial', 'failed', 'ongoing'], description: 'Session outcome' },
        pr_url: { type: ['string', 'null'], description: 'GitHub PR URL if created' },
        session_title: { type: ['string', 'null'], description: 'Concise session title (max 60 chars)' },
        // Conversation summary field
        conversation_summary: { type: 'string', description: '2-3 sentence summary of conversation (max 200 chars)' },
      },
      required: ['short_summary', 'full_summary', 'key_actions', 'files_modified', 'outcome', 'conversation_summary'],
    };

    // Call Claude with combined schema
    const responseText = await _callClaudeWithCustomSchema(
      combinedPrompt,
      recentMessages,
      session.status,
      {
        sessionId,
        conversationId,
        callType: 'generateCombinedSummary',
      },
      COMBINED_SUMMARY_SYSTEM_PROMPT,
      combinedSchema
    );

    // Parse response and convert from snake_case to camelCase
    let summaryData;
    let conversationSummaryText;
    try {
      const parsed = JSON.parse(responseText);

      // Convert snake_case to camelCase to match repository expectations
      summaryData = {
        shortSummary: parsed.short_summary,
        fullSummary: parsed.full_summary,
        keyActions: parsed.key_actions || [],
        filesModified: parsed.files_modified || [],
        outcome: parsed.outcome || 'ongoing',
        prUrl: parsed.pr_url || null,
        sessionTitle: parsed.session_title || null,
      };

      // Extract conversation summary
      conversationSummaryText = parsed.conversation_summary || 'Conversation summary generation failed';
    } catch (parseError) {
      console.error(`[SummaryService] Failed to parse combined summary response:`, parseError.message);
      console.error(`[SummaryService] Response text:`, responseText);
      return { sessionSummary: null, conversationSummary: null };
    }

    // Verify required fields exist
    if (!summaryData.shortSummary || !summaryData.fullSummary) {
      console.error(`[SummaryService] Combined summary missing required fields:`, Object.keys(summaryData));
      return { sessionSummary: null, conversationSummary: null };
    }

    // Add message count and last message ID for staleness tracking (Phase 6)
    summaryData.messageCount = allMessages.length;
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    summaryData.lastSummarizedMessageId = lastMessage ? lastMessage.id : null;

    // For root sessions, aggregate files from child sessions
    if (!session.parentSessionId) {
      summaryData.filesModified = _aggregateFilesModified(sessionId, summaryData.filesModified);
    }

    // Validate and enrich PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
      const project = projects.getById(session.projectId);
      const projectRepoUrl = project?.repoUrl;
      const validation = _validatePrUrl(prUrl, projectRepoUrl);

      if (!validation.valid) {
        console.warn(`[SummaryService] PR URL validation failed for session ${sessionId}:`, validation.error);
        summaryData.prUrl = null;
      } else {
        try {
          const prInfo = await ghService.getPrInfo(prUrl);
          summaryData.prMerged = prInfo.merged;
          summaryData.prState = prInfo.state;
          summaryData.hasMergeConflicts = prInfo.hasMergeConflicts;
          summaryData.ciStatus = prInfo.ciStatus;
        } catch (error) {
          console.warn(`[SummaryService] Failed to fetch PR info for ${prUrl}:`, error.message);
        }
      }
    } else {
      summaryData.prUrl = null;
    }

    // Save session summary
    const savedSessionSummary = sessionSummaries.upsert(sessionId, summaryData);

    // Save conversation summary
    conversations.update(conversationId, { summary: conversationSummaryText });

    // Broadcast updates
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary: savedSessionSummary,
    });

    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_SUMMARY_UPDATED, {
      sessionId,
      conversationId,
      summary: conversationSummaryText,
    });

    // Clear the generating flag so the UI knows generation is complete
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return {
      sessionSummary: savedSessionSummary,
      conversationSummary: conversationSummaryText,
    };
  } catch (error) {
    console.error(`[SummaryService] Error generating combined summary for session ${sessionId}:`, error);

    // Clear the generating flag on error
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: false,
    });

    return { sessionSummary: null, conversationSummary: null };
  }
}

/**
 * Call Claude with a custom JSON schema (for combined summaries)
 * @param {string} prompt - The prompt to send
 * @param {Array} recentMessages - Messages for context
 * @param {string} sessionStatus - Session status
 * @param {Object} logMeta - Logging metadata
 * @param {string} systemPrompt - System prompt
 * @param {Object} jsonSchema - Custom JSON schema
 * @returns {Promise<string>} The text response
 */
async function _callClaudeWithCustomSchema(prompt, recentMessages, sessionStatus, logMeta, systemPrompt, jsonSchema) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  if (_isMockMode()) {
    // Use mock query for combined summary
    return await _callClaudeWithCustomSchemaMock(prompt, recentMessages, sessionStatus);
  }

  const queryParams = {
    prompt,
    options: {
      cwd: process.cwd(),
      permissionMode: 'bypassPermissions',
      maxTurns: 1,
      model: 'claude-haiku-4-5-20251001',
      systemPrompt,
      outputFormat: {
        type: 'json_schema',
        schema: jsonSchema,
      },
    },
  };

  // Start logging if metadata provided
  let callId = null;
  if (logMeta) {
    callId = agentCallLogger.startCall({
      sessionId: logMeta.sessionId,
      conversationId: logMeta.conversationId || null,
      agentType: 'summary',
      model: 'claude-haiku-4-5-20251001',
      callType: logMeta.callType,
      promptLength: prompt.length,
    });
  }

  let responseText = '';
  let structuredOutput = null;

  try {
    for await (const event of query(queryParams)) {
      switch (event.type) {
        case 'assistant': {
          const content = event.message?.content || [];
          for (const block of content) {
            if (block.type === 'tool_use' && block.name === 'StructuredOutput') {
              structuredOutput = block.input;
            } else if (block.type === 'text') {
              responseText += block.text;
            }
          }
          break;
        }
        case 'result': {
          if (event.subtype === 'error') {
            throw new Error(event.error || 'Claude SDK query failed');
          }
          if (callId) {
            const modelUsageEntry = event.modelUsage
              ? Object.values(event.modelUsage)[0]
              : null;
            if (modelUsageEntry || event.usage) {
              agentCallLogger.updateUsage(callId, {
                inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
                outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
                thinkingTokens: 0,
                cacheReadInputTokens: modelUsageEntry?.cacheReadInputTokens || event.usage?.cache_read_input_tokens || 0,
                cacheCreationInputTokens: modelUsageEntry?.cacheCreationInputTokens || event.usage?.cache_creation_input_tokens || 0,
              });
            }
          }
          break;
        }
      }
    }

    if (callId) {
      agentCallLogger.completeCall(callId, { success: true });
    }
  } catch (error) {
    if (callId) {
      agentCallLogger.completeCall(callId, { success: false, error });
    }
    throw error;
  }

  if (structuredOutput) {
    return JSON.stringify(structuredOutput);
  }
  return responseText;
}

/**
 * Mock query for combined summary generation in test mode
 */
async function _callClaudeWithCustomSchemaMock(prompt, recentMessages, sessionStatus) {
  let outcome = 'ongoing';
  if (sessionStatus === 'stopped') outcome = 'partial';
  else if (sessionStatus === 'error') outcome = 'failed';

  const lastMessage = recentMessages[recentMessages.length - 1];
  const shortPreview = lastMessage ? lastMessage.content.substring(0, 100) : 'testing session';

  return JSON.stringify({
    short_summary: `Mock summary: ${shortPreview}...`.substring(0, 150),
    full_summary: `This is a mock summary for testing purposes. The session has ${recentMessages.length} messages and is currently ${sessionStatus}.`,
    key_actions: ['Mock action 1', 'Mock action 2'],
    files_modified: ['mock-file.js'],
    outcome: outcome,
    pr_url: null,
    session_title: `Mock: ${shortPreview}`.substring(0, 60),
    conversation_summary: `Mock conversation summary for testing with ${recentMessages.length} messages.`,
  });
}

/**
 * Propagate summary update to parent sessions
 * When a child session's summary is updated, the parent's summary may need regeneration
 * @param {string} sessionId - The child session ID that was updated
 */
export async function propagateToParentExported(sessionId) {
  propagateToParent(sessionId, onSessionActivity);
}

// Export for testing
export { DEBOUNCE_DELAY, MAX_MESSAGES, MIN_MESSAGES_FOR_SUMMARY, MAX_RETRIES, activeGenerations, pendingRegenerations };
