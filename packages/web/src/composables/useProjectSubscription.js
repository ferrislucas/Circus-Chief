import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { useWebSocket } from './useWebSocket.js';

// Track active project subscriptions for re-subscription on reconnect
export const projectSubscriptionIds = new Set();

/**
 * Create a filtered event handler factory for a project-scoped WebSocket event.
 * @param {Object} ws - WebSocket { on, off } methods
 * @param {string} projectId - Project ID to filter by
 * @param {string} messageType - WS_MESSAGE_TYPES constant
 * @param {Function} extractor - Extracts callback args from the message
 * @returns {Function} Handler registration function
 */
function createProjectHandler(ws, projectId, messageType, extractor) {
  return (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(...extractor(msg));
      }
    };
    ws.on(messageType, handler);
    return () => ws.off(messageType, handler);
  };
}

/**
 * Create session event handlers for project subscription.
 */
function createSessionHandlers(ws, projectId) {
  return {
    onSessionCreated: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.SESSION_CREATED, (msg) => [msg.session]),
    onSessionUpdated: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, (msg) => [msg.session]),
    onSessionDeleted: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.SESSION_DELETED, (msg) => [msg.sessionId]),
    onSessionSummaryUpdated: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, (msg) => [msg.sessionId, msg.summary]),
  };
}

/**
 * Create command run event handlers for project subscription.
 */
function createCommandHandlers(ws, projectId) {
  return {
    onCommandRunOutput: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, (msg) => [msg.runId, msg.sessionId, msg.buttonId, msg.output]),
    onCommandRunComplete: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, (msg) => [{
      runId: msg.runId,
      sessionId: msg.sessionId,
      buttonId: msg.buttonId,
      exitCode: msg.exitCode,
      output: msg.output,
      status: msg.status,
    }]),
    onCommandRunError: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, (msg) => [msg.runId, msg.sessionId, msg.buttonId, msg.error]),
    onCommandRunDeleted: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, (msg) => [msg.runId, msg.sessionId, msg.buttonId]),
  };
}

/**
 * Create kanban event handlers for project subscription.
 */
function createKanbanHandlers(ws, projectId) {
  return {
    onKanbanBoardUpdated: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, (msg) => [msg.board]),
    onKanbanCardMoved: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, (msg) => [msg.cardId, msg.fromLaneId, msg.toLaneId, msg.card]),
    onKanbanCardAdded: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, (msg) => [msg.card, msg.laneId]),
    onKanbanCardRemoved: createProjectHandler(ws, projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, (msg) => [msg.cardId, msg.laneId]),
  };
}

/**
 * Subscribe to project updates (session list changes)
 * @param {string} projectId
 */
export function useProjectSubscription(projectId) {
  const ws = useWebSocket();
  const { send } = ws;

  const subscribe = () => {
    projectSubscriptionIds.add(projectId);
    send(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId });
  };

  const unsubscribe = () => {
    projectSubscriptionIds.delete(projectId);
    send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId });
  };

  // Auto-cleanup on unmount
  onUnmounted(() => {
    unsubscribe();
  });

  return {
    subscribe,
    unsubscribe,
    ...createSessionHandlers(ws, projectId),
    ...createCommandHandlers(ws, projectId),
    ...createKanbanHandlers(ws, projectId),
  };
}
