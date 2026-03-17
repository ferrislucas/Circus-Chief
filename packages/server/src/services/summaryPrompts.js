/**
 * Prompt templates and message formatting for summary generation.
 * Pure functions with no side effects.
 */

// Maximum retry attempts for failed parsing
export const MAX_RETRIES = 2;

// Minimum number of messages before generating a summary (skip trivial sessions)
export const MIN_MESSAGES_FOR_SUMMARY = 3;

// Maximum number of recent messages to include in generation (optimized for token efficiency)
export const MAX_MESSAGES = 10;

// Default prompt for strategic session titles
export const DEFAULT_SESSION_TITLE_PROMPT = `Guidelines for generating session titles:
- The title should capture the SESSION'S STRATEGIC GOAL, not current tactical activity
- Focus on WHAT the user ultimately wants to achieve (e.g., "Add dark mode support")
- NOT the current step (e.g., "Fix TypeScript error", "Update tests")
- If a PR was created, format as "PR #N: <strategic goal>"
- PRESERVE the existing title if it still reflects the strategic goal
- Only change the title if the session's fundamental purpose has changed
- Keep titles concise (max 60 characters)`;

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

// System prompt for conversation summary generation
export const CONVERSATION_SUMMARY_SYSTEM_PROMPT = `You are generating a brief summary for a conversation thread within a Claude Code session.

Generate a concise summary of this conversation. Focus on:
1. The main topic or goal discussed
2. Key actions taken or decisions made
3. Current status (completed, in progress, blocked, etc.)`;

// Combined system prompt for generating both session and conversation summaries in one call
export const COMBINED_SUMMARY_SYSTEM_PROMPT = `You are generating summaries for a Claude Code session.

Generate TWO summaries:

1. SESSION SUMMARY - An overview of the entire session:
   - Preserves important context from the existing summary
   - Incorporates new actions and progress from recent messages
   - Updates the outcome status if changed
   - Maintains a coherent narrative of the full session

   Session outcome guidelines:
   - "completed": Task was fully accomplished
   - "partial": Some progress made but task incomplete
   - "failed": Task encountered errors and couldn't proceed
   - "ongoing": Session is still active/waiting for user input

2. CONVERSATION SUMMARY - A brief summary of the active conversation thread:
   - The main topic or goal discussed
   - Key actions taken or decisions made
   - Current status (completed, in progress, blocked, etc.)`;

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
        content = content.substring(0, 500) + '... [truncated]';
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
 * Build prompt for conversation summary generation
 * @param {Array} conversationMessages - Messages in the conversation
 * @returns {string}
 */
export function buildConversationSummaryPrompt(conversationMessages) {
  const formattedMessages = formatMessages(conversationMessages);

  // Return only dynamic content - static instructions are in system prompt
  return `CONVERSATION:
${formattedMessages}`;
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
 * @param {Object} summaryData - Summary data to augment
 * @param {Array} allMessages - All messages in session
 */
export function trackMessageMetadata(summaryData, allMessages) {
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
      keyActions: parsed.key_actions || [],
      filesModified: parsed.files_modified || [],
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

/**
 * Parse conversation summary response
 * @param {string} responseText
 * @returns {string} The summary text
 */
export function parseConversationSummaryResponse(responseText) {
  const textToParse = stripMarkdownCodeBlock(responseText);

  try {
    const parsed = JSON.parse(textToParse);
    return parsed.summary || 'Summary generation failed';
  } catch {
    // If parsing fails, return the raw text truncated
    return textToParse.substring(0, 200);
  }
}

// Backward-compatible aliases for internal/test usage
export { stripMarkdownCodeBlock as _stripMarkdownCodeBlock };
export { trackMessageMetadata as _trackMessageMetadata };
