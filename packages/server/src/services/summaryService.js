import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, sessionSummaries } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as ghService from './ghService.js';

// Debounce timers per session
const debounceTimers = new Map();

// Debounce delay in milliseconds (5 seconds - reduced from 15s for faster feedback)
const DEBOUNCE_DELAY = 5000;

// Maximum number of recent messages to include in generation
const MAX_MESSAGES = 50;

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
  if (sessionStatus === 'completed') outcome = 'completed';
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
 * @param {string} responseText
 * @returns {Object}
 */
function parseSummaryResponse(responseText) {
  try {
    // Try to parse as JSON directly
    const parsed = JSON.parse(responseText);
    return {
      shortSummary: parsed.short_summary || 'Summary generation failed',
      fullSummary: parsed.full_summary || 'Unable to generate summary',
      keyActions: parsed.key_actions || [],
      filesModified: parsed.files_modified || [],
      outcome: parsed.outcome || 'ongoing',
      prUrl: parsed.pr_url || null,
      sessionTitle: parsed.session_title || null,
    };
  } catch {
    // If JSON parsing fails, try to extract from the response
    console.warn('[SummaryService] Failed to parse summary response as JSON, using fallback');
    return {
      shortSummary: responseText.substring(0, 150),
      fullSummary: responseText.substring(0, 500),
      keyActions: [],
      filesModified: [],
      outcome: 'ongoing',
      prUrl: null,
      sessionTitle: null,
    };
  }
}

/**
 * Generate summary for a session using Claude Code SDK
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`[SummaryService] Session ${sessionId} not found for summary generation`);
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

      // Broadcast session update for real-time UI sync
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        sessionId,
        session: updatedSession,
      });
    }

    // Broadcast updated summary
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary,
    });

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
 * Called when session completes - generate immediately
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

// Export for testing
export { DEBOUNCE_DELAY, MAX_MESSAGES, isMockMode, callClaude, formatMessages, buildIncrementalPrompt, parseSummaryResponse };
