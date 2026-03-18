import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { useWebSocket } from './useWebSocket.js';

// Track active project subscriptions for re-subscription on reconnect
export const projectSubscriptionIds = new Set();

/**
 * Subscribe to project updates (session list changes)
 * @param {string} projectId
 */
export function useProjectSubscription(projectId) {
  const { send, on, off } = useWebSocket();

  const subscribe = () => {
    projectSubscriptionIds.add(projectId);
    send(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId });
  };

  const unsubscribe = () => {
    projectSubscriptionIds.delete(projectId);
    send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId });
  };

  const onSessionCreated = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.session);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_CREATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_CREATED, handler);
  };

  const onSessionUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.session);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
  };

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

  // Command run handlers for real-time status icon updates on session lists
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
  onUnmounted(() => {
    unsubscribe();
  });

  return {
    subscribe,
    unsubscribe,
    onSessionCreated,
    onSessionUpdated,
    onSessionDeleted,
    onSessionSummaryUpdated,
    onCommandRunOutput,
    onCommandRunComplete,
    onCommandRunError,
    onKanbanBoardUpdated,
    onKanbanCardMoved,
    onKanbanCardAdded,
    onKanbanCardRemoved,
  };
}
