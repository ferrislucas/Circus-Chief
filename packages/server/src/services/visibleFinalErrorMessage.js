import { sessions, conversations, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { randomUUID } from 'node:crypto';

// Provider/adapter failures can contain prompts, paths, credentials, or other
// operational details.  This string is deliberately the only failure detail
// that crosses the durable session/message and websocket boundaries.
export const GENERIC_FINAL_ERROR_MESSAGE = 'The agent could not complete this turn. Please try again.';

export function createErrorCorrelationId() {
  return randomUUID();
}

export function buildClientFacingError(correlationId) {
  return `${GENERIC_FINAL_ERROR_MESSAGE} Reference ID: ${correlationId}`;
}

/** Log the diagnostic payload without making it durable or client-visible. */
export function logDetailedSessionError(sessionId, correlationId, error, label = 'Session error') {
  console.error(`[${label}] session=${sessionId} correlationId=${correlationId}`, error);
  if (error?.stack) {
    console.error(`[${label}] session=${sessionId} correlationId=${correlationId} stack:`, error.stack);
  }
}

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

function buildVisibleErrorContent(clientFacingError) {
  return clientFacingError;
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
 * We intentionally do not compare raw provider text here. That data must never
 * be copied into a durable message merely because it appeared in an error.
 *
 * @param {Array} conversationMessages - All messages in the conversation
 * @param {string} generatedContent - The formatted error content we would create
 * @returns {boolean} True if a duplicate error message already exists
 */
function hasExistingVisibleFailure(conversationMessages, generatedContent) {
  const normalizedGenerated = normalizeMessageContent(generatedContent);
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

  // Check for the same client-facing failure after the latest user message.
  return conversationMessages
    .slice(latestUserIndex + 1)
    .some((message) => {
      if (message.role !== 'assistant') {
        return false;
      }
      const normalizedContent = normalizeMessageContent(message.content);
      return normalizedContent === normalizedGenerated;
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

export function createVisibleFinalErrorMessage(sessionId, clientFacingError, activeConversationIds) {
  const conversationId = resolveErrorConversationId(sessionId, activeConversationIds);
  if (!conversationId) {
    return null;
  }

  const content = buildVisibleErrorContent(clientFacingError);
  const conversationMessages = messages.getByConversationId(conversationId) || [];

  if (hasExistingVisibleFailure(conversationMessages, content)) {
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
