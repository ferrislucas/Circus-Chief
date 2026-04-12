/**
 * Prompt templates and message formatting for summary generation.
 * Pure functions with no side effects.
 */

import { DEFAULT_SESSION_TITLE_PROMPT } from '@circuschief/shared';

// Maximum retry attempts for failed parsing
export const MAX_RETRIES = 2;

// Minimum number of messages before generating a summary (skip trivial sessions)
export const MIN_MESSAGES_FOR_SUMMARY = 3;

// Maximum number of recent messages to include in generation (optimized for token efficiency)
export const MAX_MESSAGES = 10;

// Re-export from shared for backward compatibility
export { DEFAULT_SESSION_TITLE_PROMPT };

// System prompt for summary generation (static instructions that benefit from prompt caching)
export const SUMMARY_SYSTEM_PROMPT = `You are updating a session summary for a Claude Code session.

Generate an updated summary that:
1. Preserves important context from the existing summary
2. Incorporates new actions and progress from recent messages
3. Updates the outcome status if changed
4. Maintains a coherent narrative of the full session

Outcome guidelines:
- "completed": Task was fully accomplished
- "partial": Some progress made but task incomplete
- "failed": Task encountered errors and couldn't proceed
- "ongoing": Session is still active/waiting for user input`;

/**
 * Format messages for the prompt
 * @param {Array} messageList - List of messages
 * @returns {string}
 */
export function formatMessages(messageList) {
  return messageList
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let content = msg.content;

      // Truncate very long messages (optimized for token efficiency)
      if (content.length > 500) {
        content = `${content.substring(0, 500)  }... [truncated]`;
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
 * @param {{ projectTitlePrompt?: string|null, childContext?: string }} options - Optional parameters
 * @returns {string}
 */
export function buildIncrementalPrompt(existingSummary, recentMessages, sessionStatus, options = {}) {
  const { projectTitlePrompt = null, childContext = '' } = options || {};
  const existingContext = existingSummary
    ? `EXISTING SUMMARY:
${existingSummary.fullSummary}

Key actions so far: ${JSON.stringify(existingSummary.keyActions || [])}
Files modified: ${JSON.stringify(existingSummary.filesModified || [])}
Previous outcome: ${existingSummary.outcome}
Previous title: ${existingSummary.sessionTitle || 'Not set'}`
    : 'EXISTING SUMMARY:\nNo previous summary - this is the first generation.';

  const formattedMessages = formatMessages(recentMessages);

  // Use custom prompt if provided, otherwise use default
  const sessionTitlePrompt = projectTitlePrompt || DEFAULT_SESSION_TITLE_PROMPT;

  // Return only dynamic content - static instructions are in SUMMARY_SYSTEM_PROMPT
  return `Current session status: ${sessionStatus}

${existingContext}
${childContext}
RECENT CONVERSATION:
${formattedMessages}

Session title guidelines:
${sessionTitlePrompt}`;
}

/**
 * Strip markdown code block wrapping (```json ... ```) from response text
 * @param {string} text - Raw response text
 * @returns {string} Text with code block wrapper removed if present
 */
export function stripMarkdownCodeBlock(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
      console.log('[SummaryPrompts] Stripped markdown code block from response');
    }
  }
  return cleaned;
}

/**
 * Add message count and last message ID to summary data for staleness tracking
 * @param {Object} summaryDataInput - Summary data to augment
 * @param {Array} allMessages - All messages in session
 */
export function trackMessageMetadata(summaryDataInput, allMessages) {
  const summaryData = summaryDataInput;
  summaryData.messageCount = allMessages.length;
  const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
  summaryData.lastSummarizedMessageId = lastMessage ? lastMessage.id : null;
}

/**
 * Parse the Claude API response into a summary object
 * Handles markdown code block wrapping (```json ... ```) that Claude sometimes returns
 * @param {string} responseText
 * @returns {Object}
 */
export function parseSummaryResponse(responseText) {
  const textToParse = stripMarkdownCodeBlock(responseText);

  try {
    const parsed = JSON.parse(textToParse);
    return {
      shortSummary: parsed.short_summary || 'Summary generation failed',
      fullSummary: parsed.full_summary || 'Unable to generate summary',
      keyActions: Array.isArray(parsed.key_actions) ? parsed.key_actions :
        (typeof parsed.key_actions === 'string' ? [parsed.key_actions] : []),
      filesModified: Array.isArray(parsed.files_modified) ? parsed.files_modified :
        (typeof parsed.files_modified === 'string' ? [parsed.files_modified] : []),
      outcome: parsed.outcome || 'ongoing',
      prUrl: parsed.pr_url || null,
      sessionTitle: parsed.session_title || null,
      _parseFailed: false,
    };
  } catch {
    // If JSON parsing fails, return fallback with flag for retry logic
    console.warn('[SummaryPrompts] Failed to parse summary response as JSON, using fallback');
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

// Backward-compatible aliases for internal/test usage
export { stripMarkdownCodeBlock as _stripMarkdownCodeBlock };
export { trackMessageMetadata as _trackMessageMetadata };
