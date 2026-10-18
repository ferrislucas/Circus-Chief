import { workLogs } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { pinTierMemberOnDurableActivity } from './tierMemberPin.js';

/**
 * Create and broadcast an unassociated work log entry.
 * Logs are associated with the assistant message when the turn completes.
 */
export function createWorkLog(sessionId, type, content, toolName = null) {
  const log = workLogs.create(sessionId, type, content, { messageId: null, toolName });
  // A persisted work log (tool input/output, thinking, denials) is durable
  // observable activity: a tier-backed attempt that has produced it owns the
  // conversation from this instant, even if the turn later ends in a terminal
  // error. Idempotent no-op outside a tier attempt.
  pinTierMemberOnDurableActivity(sessionId);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOG, { sessionId, log });
  return log;
}
