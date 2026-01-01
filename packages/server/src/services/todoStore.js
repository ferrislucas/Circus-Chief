import { todos } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Update todos for a session (replaces all existing todos)
 * Called when Claude executes TodoWrite
 * @param {string} sessionId
 * @param {Array<{content: string, status: string}>} todoList
 * @returns {Array}
 */
export function updateTodos(sessionId, todoList) {
  const updatedTodos = todos.replaceAll(sessionId, todoList);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TODOS_UPDATE, {
    sessionId,
    todos: updatedTodos,
  });
  return updatedTodos;
}

/**
 * Get all todos for a session
 * @param {string} sessionId
 * @returns {Array}
 */
export function getTodos(sessionId) {
  return todos.getBySessionId(sessionId);
}

/**
 * Clear all todos for a session
 * @param {string} sessionId
 */
export function clearTodos(sessionId) {
  todos.deleteBySessionId(sessionId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TODOS_UPDATE, {
    sessionId,
    todos: [],
  });
}
