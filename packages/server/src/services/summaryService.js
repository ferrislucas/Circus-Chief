import Anthropic from '@anthropic-ai/sdk';
import { sessions, messages, sessionSummaries } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Debounce timers per session
const debounceTimers = new Map();

// Debounce delay in milliseconds (15 seconds)
const DEBOUNCE_DELAY = 15000;

// Maximum number of recent messages to include in generation
const MAX_MESSAGES = 50;

// Claude Haiku model for cost-effective generation
const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

// Check if mock mode is enabled
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

// Anthropic client (lazy initialized)
let anthropicClient = null;

function getAnthropicClient() {
  if (!anthropicClient && !isMockMode()) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
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
  "outcome": "completed|partial|failed|ongoing"
}

Outcome guidelines:
- "completed": Task was fully accomplished
- "partial": Some progress made but task incomplete
- "failed": Task encountered errors and couldn't proceed
- "ongoing": Session is still active/waiting for user input`;
}

/**
 * Generate a mock summary for testing
 * @param {Array} recentMessages
 * @param {string} sessionStatus
 * @returns {Object}
 */
function generateMockSummary(recentMessages, sessionStatus) {
  const lastMessage = recentMessages[recentMessages.length - 1];
  const shortSummary = lastMessage
    ? `Mock summary: ${lastMessage.content.substring(0, 100)}...`
    : 'Mock session summary for testing';

  return {
    shortSummary: shortSummary.substring(0, 150),
    fullSummary: `This is a mock summary for testing purposes. The session has ${recentMessages.length} messages and is currently ${sessionStatus}.`,
    keyActions: ['Mock action 1', 'Mock action 2'],
    filesModified: ['mock-file.js'],
    outcome: sessionStatus === 'completed' ? 'completed' : sessionStatus === 'error' ? 'failed' : 'ongoing',
  };
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
    };
  } catch {
    // If JSON parsing fails, try to extract from the response
    console.warn('Failed to parse summary response as JSON, using fallback');
    return {
      shortSummary: responseText.substring(0, 150),
      fullSummary: responseText.substring(0, 500),
      keyActions: [],
      filesModified: [],
      outcome: 'ongoing',
    };
  }
}

/**
 * Generate summary for a session using Claude API
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function generateSummary(sessionId) {
  try {
    // Get session info
    const session = sessions.getById(sessionId);
    if (!session) {
      console.warn(`Session ${sessionId} not found for summary generation`);
      return null;
    }

    // Get existing summary for incremental generation
    const existingSummary = sessionSummaries.getBySessionId(sessionId);

    // Get recent messages
    const allMessages = messages.getBySessionId(sessionId);
    const recentMessages = allMessages.slice(-MAX_MESSAGES);

    if (recentMessages.length === 0) {
      console.warn(`No messages found for session ${sessionId}`);
      return null;
    }

    // Broadcast that we're generating
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, {
      sessionId,
      generating: true,
    });

    let summaryData;

    if (isMockMode()) {
      // Use mock summary for testing
      summaryData = generateMockSummary(recentMessages, session.status);
    } else {
      // Build prompt
      const prompt = buildIncrementalPrompt(existingSummary, recentMessages, session.status);

      // Call Claude API
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const responseText = response.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');

      // Parse response
      summaryData = parseSummaryResponse(responseText);
    }

    // Add message count for staleness tracking
    summaryData.messageCount = allMessages.length;

    // Upsert summary
    const summary = sessionSummaries.upsert(sessionId, summaryData);

    // Broadcast updated summary
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary,
    });

    return summary;
  } catch (error) {
    console.error(`Error generating summary for session ${sessionId}:`, error);

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

  // Set new 15s timer
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
