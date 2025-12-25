import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, sessionSummaries, conversations, projects } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as ghService from './ghService.js';
// Note: prStatusService is imported dynamically in onSessionComplete to avoid circular dependency

// Debounce timers per session
const debounceTimers = new Map();

// Debounce delay in milliseconds (5 seconds - reduced from 15s for faster feedback)
const DEBOUNCE_DELAY = 5000;

// Maximum number of recent messages to include in generation
const MAX_MESSAGES = 50;

// Maximum retry attempts for failed parsing
const MAX_RETRIES = 2;

// Check if mock mode is enabled
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Mock query generator for summary generation in test mode
 * Mirrors the Claude Code SDK's async generator pattern
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 * @param {Array} params.recentMessages - Messages for mock context
 * @param {string} params.sessionStatus - Session status for mock outcome
 */
async function* mockSummaryQuery({ prompt: _prompt, recentMessages, sessionStatus }) {
  // Yield system init event (matches SDK pattern)
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-summary-' + Date.now(),
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Derive outcome from session status
  let outcome = 'ongoing';
  if (sessionStatus === 'stopped') outcome = 'partial';
  else if (sessionStatus === 'error') outcome = 'failed';

  // Create contextual mock response
  const lastMessage = recentMessages[recentMessages.length - 1];
  const shortPreview = lastMessage ? lastMessage.content.substring(0, 100) : 'testing session';

  const mockResponse = JSON.stringify({
    short_summary: `Mock summary: ${shortPreview}...`.substring(0, 150),
    full_summary: `This is a mock summary for testing purposes. The session has ${recentMessages.length} messages and is currently ${sessionStatus}.`,
    key_actions: ['Mock action 1', 'Mock action 2'],
    files_modified: ['mock-file.js'],
    outcome: outcome,
    pr_url: null,
    session_title: `Mock: ${shortPreview}`.substring(0, 60),
  });

  // Yield assistant message with mock response
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: mockResponse }],
    },
  };

  // Yield result event
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0001,
  };
}

/**
 * Call Claude via SDK and extract text response
 * @param {string} prompt - The prompt to send
 * @param {Array} recentMessages - Messages (for mock mode context)
 * @param {string} sessionStatus - Session status (for mock mode context)
 * @returns {Promise<string>} The text response
 */
async function callClaude(prompt, recentMessages, sessionStatus) {
  const queryFn = isMockMode() ? mockSummaryQuery : query;

  // JSON Schema for structured output
  const summarySchema = {
    type: 'object',
    properties: {
      short_summary: { type: 'string', description: '1-2 sentence preview for list view (max 150 characters)' },
      full_summary: { type: 'string', description: 'Detailed summary with key accomplishments and current state (max 500 characters)' },
      key_actions: { type: 'array', items: { type: 'string' }, description: 'List of key actions taken' },
      files_modified: { type: 'array', items: { type: 'string' }, description: 'List of files that were modified' },
      outcome: { type: 'string', enum: ['completed', 'partial', 'failed', 'ongoing'], description: 'Session outcome status' },
      pr_url: { type: ['string', 'null'], description: 'GitHub PR URL if one was created' },
      session_title: { type: ['string', 'null'], description: 'Concise title for this session (max 60 characters)' },
    },
    required: ['short_summary', 'full_summary', 'key_actions', 'files_modified', 'outcome'],
  };

  const queryParams = isMockMode()
    ? { prompt, recentMessages, sessionStatus }
    : {
        prompt,
        options: {
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          model: 'claude-haiku-4-5-20251001',
          outputFormat: {
            type: 'json_schema',
            schema: summarySchema,
          },
        },
      };

  let responseText = '';
  let structuredOutput = null;

  for await (const event of queryFn(queryParams)) {
    switch (event.type) {
      case 'assistant': {
        const content = event.message?.content || [];
        for (const block of content) {
          // Capture structured output from StructuredOutput tool use
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
        break;
      }
    }
  }

  // Prefer structured output (already parsed JSON) over text response
  if (structuredOutput) {
    return JSON.stringify(structuredOutput);
  }
  return responseText;
}

/**
 * Format messages for the prompt
 * @param {Array} messageList - List of messages
 * @returns {string}
 */
function formatMessages(messageList) {
  return messageList
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let content = msg.content;

      // Truncate very long messages
      if (content.length > 2000) {
        content = content.substring(0, 2000) + '... [truncated]';
      }

      // Add tool use info if present
      if (msg.toolUse && msg.toolUse.length > 0) {
        const tools = msg.toolUse.map((t) => t.name).join(', ');
        content += `\n[Tools used: ${tools}]`;
      }

      return `${role}: ${content}`;
    })
    .join('\n\n');
}

/**
 * Build the prompt for incremental summary generation
 * @param {Object|null} existingSummary - Existing summary if any
 * @param {Array} recentMessages - Recent messages to summarize
 * @param {string} sessionStatus - Current session status
 * @returns {string}
 */
function buildIncrementalPrompt(existingSummary, recentMessages, sessionStatus) {
  const existingContext = existingSummary
    ? `EXISTING SUMMARY:
${existingSummary.fullSummary}

Key actions so far: ${JSON.stringify(existingSummary.keyActions || [])}
Files modified: ${JSON.stringify(existingSummary.filesModified || [])}
Previous outcome: ${existingSummary.outcome}`
    : 'EXISTING SUMMARY:\nNo previous summary - this is the first generation.';

  const formattedMessages = formatMessages(recentMessages);

  return `You are updating a session summary for a Claude Code session. Current session status: ${sessionStatus}

${existingContext}

RECENT CONVERSATION:
${formattedMessages}

Generate an updated summary that:
1. Preserves important context from the existing summary
2. Incorporates new actions and progress from recent messages
3. Updates the outcome status if changed
4. Maintains a coherent narrative of the full session

Respond with JSON only (no markdown code blocks), in this exact format:
{
  "short_summary": "1-2 sentence preview for list view (max 150 characters)",
  "full_summary": "Detailed summary with key accomplishments and current state (max 500 characters)",
  "key_actions": ["action 1", "action 2", ...],
  "files_modified": ["file1.js", "file2.js", ...],
  "outcome": "completed|partial|failed|ongoing",
  "pr_url": "https://github.com/owner/repo/pull/123 or null if no PR was created/mentioned",
  "session_title": "Concise title for this session (max 60 characters)"
}

Outcome guidelines:
- "completed": Task was fully accomplished
- "partial": Some progress made but task incomplete
- "failed": Task encountered errors and couldn't proceed
- "ongoing": Session is still active/waiting for user input

Session title guidelines:
- If a PR was created or updated, format as "PR #N: brief description"
- Otherwise, create a concise descriptive title summarizing the task`;
}

/**
 * Parse the Claude API response into a summary object
 * Handles markdown code block wrapping (```json ... ```) that Claude sometimes returns
 * @param {string} responseText
 * @returns {Object}
 */
function parseSummaryResponse(responseText) {
  let textToParse = responseText.trim();

  // Only strip markdown if detected (starts with ```)
  if (textToParse.startsWith('```')) {
    const codeBlockMatch = textToParse.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      textToParse = codeBlockMatch[1].trim();
      console.log('[SummaryService] Stripped markdown code block from response');
    }
  }

  try {
    const parsed = JSON.parse(textToParse);
    return {
      shortSummary: parsed.short_summary || 'Summary generation failed',
      fullSummary: parsed.full_summary || 'Unable to generate summary',
      keyActions: parsed.key_actions || [],
      filesModified: parsed.files_modified || [],
      outcome: parsed.outcome || 'ongoing',
      prUrl: parsed.pr_url || null,
      sessionTitle: parsed.session_title || null,
      _parseFailed: false,
    };
  } catch {
    // If JSON parsing fails, return fallback with flag for retry logic
    console.warn('[SummaryService] Failed to parse summary response as JSON, using fallback');
    return {
      shortSummary: responseText.substring(0, 150),
      fullSummary: responseText.substring(0, 500),
      keyActions: [],
      filesModified: [],
      outcome: 'ongoing',
      prUrl: null,
      sessionTitle: null,
      _parseFailed: true,
    };
  }
}

/**
 * Generate summary for a session using Claude Code SDK
 * @param {string} sessionId
 * @param {number} retryCount - Internal retry counter (do not set manually)
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId, retryCount = 0) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
      return null;
    }

    // Check if session summaries are disabled for this project
    const project = projects.getById(session.projectId);
    if (project?.disableSessionSummaries) {
      console.log(`[SummaryService] Session summaries disabled for project ${session.projectId}, skipping generation`);
      return null;
    }

    // Get existing summary for incremental generation
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Get recent messages
    const allMessages = messages.getBySessionId(sessionId);
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

    // Build prompt
    const prompt = buildIncrementalPrompt(existingSummary, recentMessages, session.status);

    // Call Claude via SDK (or mock in test mode)
    const responseText = await callClaude(prompt, recentMessages, session.status);

    // Parse response
    const summaryData = parseSummaryResponse(responseText);

    // Retry if parsing failed and we haven't exhausted retries
    if (summaryData._parseFailed && retryCount < MAX_RETRIES) {
      console.log(
        `[SummaryService] Parse failed for session ${sessionId}, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`
      );
      const backoffMs = 1000 * (retryCount + 1); // 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return generateSummary(sessionId, retryCount + 1);
    }

    // Clean up internal flag before saving
    delete summaryData._parseFailed;

    // Add message count for staleness tracking
    summaryData.messageCount = allMessages.length;

    // Enrich with GitHub PR status if we have a PR URL
    const prUrl = summaryData.prUrl || session.prUrl;
    if (prUrl) {
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

    // Upsert summary
    const summary = sessionSummaries.upsert(sessionId, summaryData);

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

    console.log(`[SummaryService] Successfully generated summary for session ${sessionId}`);
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

  // Set new debounce timer
  const timer = setTimeout(() => {
    generateSummary(sessionId);
    debounceTimers.delete(sessionId);
  }, DEBOUNCE_DELAY);

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

  // Generate summary immediately
  generateSummary(sessionId);

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
 * Force regenerate summary for a session
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function regenerateSummary(sessionId) {
  return generateSummary(sessionId);
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
 * Build prompt for conversation summary generation
 * @param {Array} conversationMessages - Messages in the conversation
 * @returns {string}
 */
function buildConversationSummaryPrompt(conversationMessages) {
  const formattedMessages = formatMessages(conversationMessages);

  return `You are generating a brief summary for a conversation thread within a Claude Code session.

CONVERSATION:
${formattedMessages}

Generate a concise summary of this conversation. Focus on:
1. The main topic or goal discussed
2. Key actions taken or decisions made
3. Current status (completed, in progress, blocked, etc.)

Respond with JSON only (no markdown code blocks):
{
  "summary": "A 2-3 sentence summary of the conversation (max 200 characters)"
}`;
}

/**
 * Parse conversation summary response
 * @param {string} responseText
 * @returns {string} The summary text
 */
function parseConversationSummaryResponse(responseText) {
  let textToParse = responseText.trim();

  // Strip markdown if detected
  if (textToParse.startsWith('```')) {
    const codeBlockMatch = textToParse.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      textToParse = codeBlockMatch[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(textToParse);
    return parsed.summary || 'Summary generation failed';
  } catch {
    // If parsing fails, return the raw text truncated
    return textToParse.substring(0, 200);
  }
}

/**
 * Generate summary for a specific conversation
 * @param {string} sessionId - The session ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string|null>} The generated summary text
 */
export async function generateConversationSummary(sessionId, conversationId) {
  try {
    // Get session to check project settings
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for conversation summary generation`);
      return null;
    }

    // Check if conversation summaries are disabled for this project
    const project = projects.getById(session.projectId);
    if (project?.disableConversationSummaries) {
      console.log(`[SummaryService] Conversation summaries disabled for project ${session.projectId}, skipping generation`);
      return null;
    }

    const conversation = conversations.getById(conversationId);
    if (!conversation || conversation.sessionId !== sessionId) {
      console.warn(`[SummaryService] Conversation ${conversationId} not found for session ${sessionId}`);
      return null;
    }

    // Get messages for this conversation
    const conversationMessages = messages.getByConversationId(conversationId);

    if (conversationMessages.length === 0) {
      console.warn(`[SummaryService] No messages found for conversation ${conversationId}`);
      return null;
    }

    // Skip very short conversations
    if (conversationMessages.length < 2) {
      const summary = 'Brief conversation with minimal content.';
      conversations.update(conversationId, {
        summary,
        summaryGeneratedAt: Date.now(),
      });
      return summary;
    }

    // Take recent messages (limit to MAX_MESSAGES)
    const recentMessages = conversationMessages.slice(-MAX_MESSAGES);

    // Build prompt
    const prompt = buildConversationSummaryPrompt(recentMessages);

    // Call Claude
    const responseText = await callClaude(prompt, recentMessages, 'waiting');

    // Parse response
    const summary = parseConversationSummaryResponse(responseText);

    // Update conversation with summary
    const updatedConversation = conversations.update(conversationId, {
      summary,
      summaryGeneratedAt: Date.now(),
    });

    // Broadcast conversation summary updated
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_SUMMARY_UPDATED, {
      sessionId,
      conversationId,
      conversation: updatedConversation,
    });

    console.log(`[SummaryService] Successfully generated summary for conversation ${conversationId}`);
    return summary;
  } catch (error) {
    console.error(`[SummaryService] Failed to generate conversation summary:`, {
      error: error.message,
      sessionId,
      conversationId,
    });
    return null;
  }
}

// Export for testing
export { DEBOUNCE_DELAY, MAX_MESSAGES, MAX_RETRIES, isMockMode, callClaude, formatMessages, buildIncrementalPrompt, parseSummaryResponse };
