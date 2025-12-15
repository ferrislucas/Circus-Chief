/**
 * WebSocket message types
 */

export const WS_MESSAGE_TYPES = {
  // Client -> Server
  SUBSCRIBE_SESSION: 'subscribe:session',
  UNSUBSCRIBE_SESSION: 'unsubscribe:session',

  // Server -> Client
  SESSION_STATUS: 'session:status',
  SESSION_MESSAGE: 'session:message',
  SESSION_PARTIAL: 'session:partial',
  SESSION_ERROR: 'session:error',
  SESSION_DELETED: 'session:deleted',
  CANVAS_ADD: 'canvas:add',
  CANVAS_REMOVE: 'canvas:remove',
};

/**
 * Create a WebSocket message
 * @param {string} type
 * @param {Object} payload
 * @returns {string}
 */
export function createMessage(type, payload) {
  return JSON.stringify({ type, ...payload });
}

/**
 * Parse a WebSocket message
 * @param {string} data
 * @returns {{ type: string, [key: string]: any } | null}
 */
export function parseMessage(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
