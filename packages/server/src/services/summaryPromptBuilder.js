/**
 * Summary Prompt Builder
 * Message formatting, prompt construction for both session and conversation summaries
 */

// Default prompt for strategic session titles
export const DEFAULT_SESSION_TITLE_PROMPT = `Guidelines for generating session titles:
- The title should capture the SESSION'S STRATEGIC GOAL, not current tactical activity
- Focus on WHAT the user ultimately wants to achieve (e.g., "Add dark mode support")
- NOT the current step (e.g., "Fix TypeScript error", "Update tests")
- If a PR was created, format as "PR #N: <strategic goal>"
- PRESERVE the existing title if it still reflects the strategic goal
- Only change the title if the session's fundamental purpose has changed
- Keep titles concise (max 60 characters)`;

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
      if (content.length > 750) {
        content = content.substring(0, 750) + '... [truncated]';
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
 * @param {string|null} projectTitlePrompt - Custom prompt for session titles (uses default if null)
 * @param {string|null} childContext - Context about child sessions (for workflow-aware summaries)
 * @returns {string}
 */
export function buildIncrementalPrompt(existingSummary, recentMessages, sessionStatus, projectTitlePrompt = null, childContext = '') {
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

  return `You are updating a session summary for a Claude Code session. Current session status: ${sessionStatus}

${existingContext}
${childContext}
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
${sessionTitlePrompt}`;
}

/**
 * Build prompt for conversation summary generation
 * @param {Array} conversationMessages - Messages in the conversation
 * @returns {string}
 */
export function buildConversationSummaryPrompt(conversationMessages) {
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
