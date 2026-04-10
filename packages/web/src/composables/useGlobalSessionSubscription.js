import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { useWebSocket } from './useWebSocket.js';

/**
 * Subscribe to all session updates globally (across all projects)
 * Used for views like ActiveSessionsView that show sessions from multiple projects
 */
export function useGlobalSessionSubscription() {
  const { on, off } = useWebSocket();

  // Helper to create session event handlers
  const createSessionHandler = (messageType) => (callback) => {
    const handler = (msg) => {
      if (msg.session) {
        callback(msg.session, msg.projectId);
      }
    };
    on(messageType, handler);
    return () => off(messageType, handler);
  };

  // Listen for session created across ALL projects
  const onSessionCreated = createSessionHandler(WS_MESSAGE_TYPES.SESSION_CREATED);

  // Listen for session updated across ALL projects
  const onSessionUpdated = createSessionHandler(WS_MESSAGE_TYPES.SESSION_UPDATED);

  // Listen for session deleted across ALL projects
  const onSessionDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId) {
        callback(msg.sessionId, msg.projectId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_DELETED, handler);
  };

  // Listen for session summary updated across ALL projects
  const onSessionSummaryUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId && msg.summary) {
        callback(msg.sessionId, msg.summary, msg.projectId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
  };

  return {
    onSessionCreated,
    onSessionUpdated,
    onSessionDeleted,
    onSessionSummaryUpdated,
  };
}
