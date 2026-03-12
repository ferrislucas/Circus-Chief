import { messages } from '../database.js';

/**
 * Format an array of messages as a readable transcript.
 * Handles different message types and truncates long content.
 * @param {Array} messageArray - Array of message objects with role and content
 * @returns {string} Formatted transcript
 */
export function formatConversationHistory(messageArray) {
  return messageArray.map(msg => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    // Truncate very long messages to avoid context overflow
    const content = msg.content.length > 10000
      ? msg.content.substring(0, 10000) + '\n[... message truncated ...]'
      : msg.content;
    return `${role}: ${content}`;
  }).join('\n\n');
}

/**
 * Build a context string from previous conversation messages.
 * Used when switching models mid-conversation to maintain context without resuming.
 * @param {string} conversationId - The conversation ID
 * @returns {string} Formatted conversation history as context, or empty string if no messages
 */
export function buildConversationContextForModelSwitch(conversationId) {
  const conversationMessages = messages.getByConversationId(conversationId);

  // Don't include the last user message (that's the current prompt)
  const previousMessages = conversationMessages.slice(0, -1);

  if (previousMessages.length === 0) {
    return '';
  }

  const transcript = formatConversationHistory(previousMessages);

  return `<conversation_history>
The following is the conversation history from this session. You switched to a different model mid-conversation, so you're seeing this context to maintain continuity. Continue naturally from where the conversation left off.

${transcript}
</conversation_history>

`;
}

/**
 * Build a context string from previous conversation messages for branched conversations.
 * Used when a conversation is branched and has no claudeSessionId (can't resume).
 * @param {string} conversationId - The conversation ID
 * @returns {string} Formatted conversation history as context, or empty string if no messages
 */
export function buildConversationContextForBranch(conversationId) {
  const conversationMessages = messages.getByConversationId(conversationId);

  // Don't include the last user message (that's the current prompt)
  const previousMessages = conversationMessages.slice(0, -1);

  if (previousMessages.length === 0) {
    return '';
  }

  const transcript = formatConversationHistory(previousMessages);

  return `<conversation_history>
The following is the conversation history from this branched session. This is a continuation of a previous conversation. Continue naturally from where the conversation left off, taking into account the full context of what was discussed before.

${transcript}
</conversation_history>

`;
}
