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
  SESSION_WORK_LOG: 'session:work_log',
  SESSION_WORK_LOGS_ASSOCIATED: 'session:work_logs_associated',
  SESSION_THINKING_PARTIAL: 'session:thinking_partial',
  SESSION_SUMMARY_UPDATED: 'session:summary_updated',
  SESSION_SUMMARY_GENERATING: 'session:summary_generating',
  CANVAS_ADD: 'canvas:add',
  CANVAS_REMOVE: 'canvas:remove',
  TODOS_UPDATE: 'todos:update',
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
