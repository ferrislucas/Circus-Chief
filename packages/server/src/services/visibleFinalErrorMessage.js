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

function hasExistingVisibleFailure(conversationMessages, generatedContent, rawErrorMessage) {
  const normalizedGenerated = normalizeMessageContent(generatedContent);
  const normalizedError = normalizeMessageContent(rawErrorMessage);
  const latestMessage = conversationMessages[conversationMessages.length - 1];

  if (
    latestMessage?.role === 'assistant' &&
    normalizeMessageContent(latestMessage.content) === normalizedGenerated
  ) {
    return true;
  }

  let latestUserIndex = -1;
  for (let i = conversationMessages.length - 1; i >= 0; i -= 1) {
    if (conversationMessages[i].role === 'user') {
      latestUserIndex = i;
      break;
    }
  }

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
