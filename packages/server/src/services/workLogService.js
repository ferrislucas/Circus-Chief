import { workLogs } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Create and broadcast an unassociated work log entry.
 * Logs are associated with the assistant message when the turn completes.
 */
export function createWorkLog(sessionId, type, content, toolName = null) {
  const log = workLogs.create(sessionId, type, content, { messageId: null, toolName });
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOG, { sessionId, log });
  return log;
}
