import { canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

/**
 * Add an item to the canvas
 * @param {string} sessionId
 * @param {Object} data
 * @returns {Object}
 */
export function addItem(sessionId, data) {
  const item = canvasItems.create(sessionId, data);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
  return item;
}

/**
 * Get all items for a session
 * @param {string} sessionId
 * @returns {Object[]}
 */
export function getItems(sessionId) {
  return canvasItems.getBySessionId(sessionId);
}

/**
 * Remove an item from the canvas
 * @param {string} sessionId
 * @param {string} itemId
 */
export function removeItem(sessionId, itemId) {
  const item = canvasItems.getById(itemId);
  if (!item || item.sessionId !== sessionId) {
    throw new Error('Canvas item not found');
  }

  canvasItems.delete(itemId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.CANVAS_REMOVE, { itemId });
}
