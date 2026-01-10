import { todos, conversations } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Update todos for a conversation (replaces all existing todos for that conversation)
 * Called when Claude executes TodoWrite
 * @param {string} sessionId
 * @param {string} conversationId
 * @param {Array<{content: string, status: string}>} todoList
 * @returns {Array}
 */
export function updateTodos(sessionId, conversationId, todoList) {
  const updatedTodos = todos.replaceAllForConversation(sessionId, conversationId, todoList);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TODOS_UPDATE, {
    sessionId,
    conversationId,
    todos: updatedTodos,
  });
  return updatedTodos;
}

/**
 * Get all todos for a conversation
 * @param {string} conversationId
 * @returns {Array}
 */
export function getTodosByConversation(conversationId) {
  return todos.getByConversationId(conversationId);
}

/**
 * Get all todos for the active conversation of a session
 * Falls back to empty array if no active conversation
 * @param {string} sessionId
 * @returns {Array}
 */
export function getTodosForSession(sessionId) {
  const activeConv = conversations.getActiveBySessionId(sessionId);
  if (activeConv) {
    return todos.getByConversationId(activeConv.id);
  }
  return [];
}

/**
 * Clear all todos for a conversation
 * @param {string} sessionId
 * @param {string} conversationId
 */
export function clearTodos(sessionId, conversationId) {
  todos.deleteByConversationId(conversationId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TODOS_UPDATE, {
    sessionId,
    conversationId,
    todos: [],
  });
}
