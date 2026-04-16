import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useWebSocket } from './useWebSocket.js';

// Reference counting for session subscriptions
// Prevents premature unsubscription when multiple components use the same session
const sessionSubscriptionCounts = new Map();

/**
 * Create a session-scoped event handler factory.
 * Registers a handler that only fires for the given sessionId, and returns an unsubscribe function.
 * @param {Function} on - WebSocket on function
 * @param {Function} off - WebSocket off function
 * @param {string} sessionId - Session to filter for
 * @returns {Function} Factory: (eventType, extractor, options?) => (callback) => unsubscribe
 */
function createSessionHandler(on, off, sessionId) {
  return (eventType, extractor, options) => (callback) => {
    const handler = (msg) => {
      if (extractor.filter(msg)) {
        callback(...extractor.args(msg));
      }
    };
    on(eventType, handler, options?.replaySessionId);
    return () => off(eventType, handler);
  };
}

/**
 * Register all session-scoped event handlers.
 * Returns an object of handler factories keyed by event name.
 * @param {Function} on - WebSocket on function
 * @param {Function} off - WebSocket off function
 * @param {string} sessionId - Session to filter for
 * @returns {Object} Map of event handler factories (e.g., onStatus, onMessage, ...)
 */
function registerEventHandlers(on, off, sessionId) {
  const bySession = (msg) => msg.sessionId === sessionId;
  const handler = createSessionHandler(on, off, sessionId);

  return {
    onStatus: handler(WS_MESSAGE_TYPES.SESSION_STATUS,
      { filter: bySession, args: (msg) => [msg.status] }),
    onMessage: handler(WS_MESSAGE_TYPES.SESSION_MESSAGE,
      { filter: (msg) => msg.message?.sessionId === sessionId, args: (msg) => [msg.message] }),
    onError: handler(WS_MESSAGE_TYPES.SESSION_ERROR,
      { filter: bySession, args: (msg) => [msg.error] }),
    onCanvasAdd: handler(WS_MESSAGE_TYPES.CANVAS_ADD,
      { filter: (msg) => msg.item?.sessionId === sessionId, args: (msg) => [msg.item] }),
    onCanvasRemove: handler(WS_MESSAGE_TYPES.CANVAS_REMOVE,
      { filter: bySession, args: (msg) => [msg.itemId] }),
    onCanvasUpdate: handler(WS_MESSAGE_TYPES.CANVAS_UPDATE,
      { filter: (msg) => msg.item?.sessionId === sessionId, args: (msg) => [msg.item] }),
    onPartial: handler(WS_MESSAGE_TYPES.SESSION_PARTIAL,
      { filter: bySession, args: (msg) => [msg.text] }),
    onTodosUpdate: handler(WS_MESSAGE_TYPES.TODOS_UPDATE,
      { filter: bySession, args: (msg) => [msg.todos, msg.conversationId] }),
    onWorkLog: handler(WS_MESSAGE_TYPES.SESSION_WORK_LOG,
      { filter: (msg) => bySession(msg) && msg.log, args: (msg) => [msg.log] }),
    onWorkLogsAssociated: handler(WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED,
      { filter: bySession, args: (msg) => [msg.messageId] }),
    onThinkingPartial: handler(WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL,
      { filter: bySession, args: (msg) => [msg.thinking] }),
    onSummaryUpdate: handler(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED,
      { filter: bySession, args: (msg) => [msg.summary] }),
    onSummaryGenerating: handler(WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING,
      { filter: bySession, args: (msg) => [msg.generating] }),
    onSessionUpdate: handler(WS_MESSAGE_TYPES.SESSION_UPDATED,
      { filter: bySession, args: (msg) => [msg.session] }),
    onConversationCreated: handler(WS_MESSAGE_TYPES.CONVERSATION_CREATED,
      { filter: bySession, args: (msg) => [msg.conversation] }),
    onConversationUpdated: handler(WS_MESSAGE_TYPES.CONVERSATION_UPDATED,
      { filter: bySession, args: (msg) => [msg.conversation] }),
    onConversationDeleted: handler(WS_MESSAGE_TYPES.CONVERSATION_DELETED,
      { filter: bySession, args: (msg) => [msg.conversationId, msg.newActiveConversation] }),
    onUsageUpdate: handler(WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE,
      { filter: bySession, args: (msg) => [msg] }, { replaySessionId: sessionId }),
    onCommandOutput: handler(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT,
      { filter: bySession, args: (msg) => [msg.runId, msg.buttonId, msg.output] }),
    onCommandComplete: handler(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE,
      { filter: bySession, args: (msg) => [msg.runId, msg.buttonId, msg.exitCode, msg.output] }),
    onCommandError: handler(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR,
      { filter: bySession, args: (msg) => [msg.runId, msg.buttonId, msg.error || msg.message] }),
    onCommandRunDeleted: handler(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED,
      { filter: bySession, args: (msg) => [msg.runId, msg.buttonId] }),
    onChangesUpdate: handler(WS_MESSAGE_TYPES.CHANGES_UPDATE,
      { filter: bySession, args: (msg) => [msg.changeCount, msg.hasChanges] }),
  };
}

/**
 * Subscribe to session updates
 * @param {string} sessionId
 */
export function useSessionSubscription(sessionId) {
  const { send, on, off, clearSessionBuffer } = useWebSocket();

  // Track whether THIS instance called subscribe
  let thisInstanceSubscribed = false;

  const subscribe = () => {
    if (thisInstanceSubscribed) return; // Already subscribed from this instance
    thisInstanceSubscribed = true;

    const count = sessionSubscriptionCounts.get(sessionId) || 0;
    sessionSubscriptionCounts.set(sessionId, count + 1);
    // Only send subscribe message on first subscription
    if (count === 0) {
      send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
    }
  };

  const unsubscribe = () => {
    if (!thisInstanceSubscribed) return; // Never subscribed, don't unsubscribe
    thisInstanceSubscribed = false;

    const count = sessionSubscriptionCounts.get(sessionId) || 0;
    if (count <= 1) {
      // Last subscriber - actually unsubscribe
      sessionSubscriptionCounts.delete(sessionId);
      send(WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION, { sessionId });
      // Clear any buffered messages for this session
      clearSessionBuffer(sessionId);
    } else {
      // Decrement count but don't unsubscribe yet
      sessionSubscriptionCounts.set(sessionId, count - 1);
    }
  };

  const eventHandlers = registerEventHandlers(on, off, sessionId);

  // Auto-cleanup on unmount
  onUnmounted(() => {
    unsubscribe();
  });

  return {
    subscribe,
    unsubscribe,
    ...eventHandlers,
  };
}

// Export for use in useWebSocket.js
export { sessionSubscriptionCounts };
