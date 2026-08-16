import { sessions, conversations, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

export function normalizeFinalErrorMessage(error) {
  if (error?.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error == null) {
    return 'Unknown error';
  }
  return String(error);
}

function normalizeMessageContent(content) {
  return (content || '').trim().replace(/\s+/g, ' ');
}

function buildVisibleErrorContent(agentType, errorMessage) {
  if (agentType === 'codex') {
    return `Codex failed before completing this turn:\n\n${errorMessage}`;
  }
  if (agentType === 'claude-code') {
    return `Claude Code failed before completing this turn:\n\n${errorMessage}`;
  }
  return `The agent failed before completing this turn:\n\n${errorMessage}`;
}

/**
 * Check if a visible error message already exists to prevent duplicates.
 *
 * Uses two strategies to detect existing failures:
 *
 * Strategy 1: Exact match with generated content
 * - Checks if the latest message is an assistant message with content exactly matching
 *   what we would generate (e.g., "Codex failed before completing this turn:\n\nerror")
 * - This catches cases where we already created the formatted error message
 *
 * Strategy 2: Raw error in messages after latest user message
 * - Finds the latest user message, then checks all subsequent assistant messages
 * - Returns true if any assistant message contains the raw error text
 * - This catches cases where the agent itself already reported the error
 *   (e.g., "Run failed: usage limit reached" contains "usage limit reached")
 *
 * @param {Array} conversationMessages - All messages in the conversation
 * @param {string} generatedContent - The formatted error content we would create
 * @param {string} rawErrorMessage - The raw error message text
 * @returns {boolean} True if a duplicate error message already exists
 */
function hasExistingVisibleFailure(conversationMessages, generatedContent, rawErrorMessage) {
  const normalizedGenerated = normalizeMessageContent(generatedContent);
  const normalizedError = normalizeMessageContent(rawErrorMessage);
  const latestMessage = conversationMessages[conversationMessages.length - 1];

  // Strategy 1: Check if the latest message is an exact match with our generated content
  if (
    latestMessage?.role === 'assistant' &&
    normalizeMessageContent(latestMessage.content) === normalizedGenerated
  ) {
    return true;
  }

  // Find the index of the latest user message
  let latestUserIndex = -1;
  for (let i = conversationMessages.length - 1; i >= 0; i -= 1) {
    if (conversationMessages[i].role === 'user') {
      latestUserIndex = i;
      break;
    }
  }

  // Strategy 2: Check if any assistant message after the latest user message contains the raw error
  return conversationMessages
    .slice(latestUserIndex + 1)
    .some((message) => {
      if (message.role !== 'assistant') {
        return false;
      }
      const normalizedContent = normalizeMessageContent(message.content);
      return normalizedContent === normalizedGenerated ||
        (normalizedError && normalizedContent.includes(normalizedError));
    });
}

function resolveErrorConversationId(sessionId, activeConversationIds) {
  const activeConversationId = activeConversationIds.get(sessionId);
  if (activeConversationId) {
    return activeConversationId;
  }
  const activeConversation = conversations.ensureActiveConversation(sessionId);
  if (activeConversation?.id) {
    activeConversationIds.set(sessionId, activeConversation.id);
    return activeConversation.id;
  }
  return null;
}

export function createVisibleFinalErrorMessage(sessionId, error, activeConversationIds) {
  const conversationId = resolveErrorConversationId(sessionId, activeConversationIds);
  if (!conversationId) {
    return null;
  }

  const session = sessions.getById(sessionId);
  const errorMessage = normalizeFinalErrorMessage(error);
  const content = buildVisibleErrorContent(session?.agentType, errorMessage);
  const conversationMessages = messages.getByConversationId(conversationId) || [];

  if (hasExistingVisibleFailure(conversationMessages, content, errorMessage)) {
    return null;
  }

  const message = messages.create(sessionId, 'assistant', content, { conversationId });
  sessions.touch(sessionId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
    message,
    conversationId,
  });
  return message;
}
