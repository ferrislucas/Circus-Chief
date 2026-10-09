import { sessions } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Mirror the CLI permission mode the agent switched itself into (e.g. 'plan'
 * after EnterPlanMode) onto the session, then notify session + project
 * subscribers via SESSION_UPDATED.
 *
 * No-op when the mode is unchanged, so routine system(status) reports do not
 * churn broadcasts.
 *
 * @param {string} sessionId
 * @param {string} mode - CLI permission mode ('default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto')
 */
export function setAgentPermissionMode(sessionId, mode) {
  const before = sessions.getById(sessionId);
  if (!before || before.agentPermissionMode === mode) return;
  const session = sessions.update(sessionId, { agentPermissionMode: mode });
  if (!session) return;
  const payload = { sessionId, session };
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, payload);
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, { ...payload, projectId: session.projectId });
}
