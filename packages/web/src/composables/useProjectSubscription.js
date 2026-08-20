import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useWebSocket } from './useWebSocket.js';

// Track active project subscriptions for re-subscription on reconnect.
// The count prevents one consumer (for example the workspace list) from
// tearing down a subscription still used by another (for example Kanban).
export const projectSubscriptionIds = new Set();
export const projectSubscriptionCounts = new Map();

/**
 * Subscribe to project updates (session list changes)
 * @param {string} projectId
 * @param {Object} options
 * @param {boolean} options.autoCleanup
 */
export function useProjectSubscription(projectId, { autoCleanup = true } = {}) {
  const { send, on, off } = useWebSocket();
  let thisInstanceSubscribed = false;

  const subscribe = () => {
    if (thisInstanceSubscribed) return;
    thisInstanceSubscribed = true;

    const count = projectSubscriptionCounts.get(projectId) || 0;
    projectSubscriptionCounts.set(projectId, count + 1);
    if (count > 0) return;

    projectSubscriptionIds.add(projectId);
    send(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId });
  };

  const unsubscribe = () => {
    if (!thisInstanceSubscribed) return;
    thisInstanceSubscribed = false;

    const count = projectSubscriptionCounts.get(projectId) || 0;
    if (count > 1) {
      projectSubscriptionCounts.set(projectId, count - 1);
      return;
    }

    projectSubscriptionCounts.delete(projectId);
    projectSubscriptionIds.delete(projectId);
    send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId });
  };

  // Helper to create session event handlers that filter by projectId
  const createSessionHandler = (messageType) => (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.session);
      }
    };
    on(messageType, handler);
    return () => off(messageType, handler);
  };

  const onSessionCreated = createSessionHandler(WS_MESSAGE_TYPES.SESSION_CREATED);

  const onSessionUpdated = createSessionHandler(WS_MESSAGE_TYPES.SESSION_UPDATED);

  const onSessionDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.sessionId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_DELETED, handler);
  };

  const onSessionSummaryUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.sessionId, msg.summary);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
  };

  const createProjectMessageHandler = messageType => callback => {
    const handler = (msg) => {
      if (msg.projectId === projectId) callback(msg);
    };
    on(messageType, handler);
    return () => off(messageType, handler);
  };

  // These messages are currently normally represented to project subscribers
  // by SESSION_UPDATED. Keeping explicit handlers makes the list lifecycle-safe
  // if the server begins forwarding the more specific events as well.
  const onSessionMessage = createProjectMessageHandler(WS_MESSAGE_TYPES.SESSION_MESSAGE);
  const onSessionStatus = createProjectMessageHandler(WS_MESSAGE_TYPES.SESSION_STATUS);

  // Command run handlers for real-time status icon updates on session lists
  const onCommandRunStarted = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) callback(msg.runId, msg.sessionId, msg.buttonId);
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_STARTED, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_STARTED, handler);
  };

  const onCommandRunOutput = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.runId, msg.sessionId, msg.buttonId, msg.output);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, handler);
  };

  const onCommandRunComplete = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback({
          runId: msg.runId,
          sessionId: msg.sessionId,
          buttonId: msg.buttonId,
          exitCode: msg.exitCode,
          output: msg.output,
          status: msg.status,
        });
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, handler);
  };

  const onCommandRunError = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.runId, msg.sessionId, msg.buttonId, msg.error);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, handler);
  };

  const onCommandRunKilled = createProjectMessageHandler(WS_MESSAGE_TYPES.COMMAND_RUN_KILLED);

  const onCommandRunDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.runId, msg.sessionId, msg.buttonId);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
  };

  // Kanban event handlers
  const onKanbanBoardUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.board);
      }
    };
    on(WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, handler);
  };

  const onKanbanCardMoved = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.cardId, msg.fromLaneId, msg.toLaneId, msg.card);
      }
    };
    on(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, handler);
    return () => off(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, handler);
  };

  const onKanbanCardAdded = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.card, msg.laneId);
      }
    };
    on(WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, handler);
    return () => off(WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, handler);
  };

  const onKanbanCardRemoved = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.cardId, msg.laneId);
      }
    };
    on(WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, handler);
    return () => off(WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, handler);
  };

  // Auto-cleanup on unmount
  if (autoCleanup) onUnmounted(unsubscribe);

  return {
    subscribe,
    unsubscribe,
    onSessionCreated,
    onSessionUpdated,
    onSessionDeleted,
    onSessionSummaryUpdated,
    onSessionMessage,
    onSessionStatus,
    onCommandRunStarted,
    onCommandRunOutput,
    onCommandRunComplete,
    onCommandRunError,
    onCommandRunKilled,
    onCommandRunDeleted,
    onKanbanBoardUpdated,
    onKanbanCardMoved,
    onKanbanCardAdded,
    onKanbanCardRemoved,
  };
}
