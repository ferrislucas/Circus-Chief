import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { useWebSocket } from './useWebSocket.js';

// Reference counting for session subscriptions
const sessionSubscriptionCounts = new Map();

/**
 * Create a filtered event handler factory for a session-scoped WebSocket event.
 * Filters messages where msg.sessionId matches the given sessionId.
 * @param {Object} ctx - Context object { ws, sessionId }
 * @param {string} messageType - WS_MESSAGE_TYPES constant
 * @param {Function} extractor - Extracts callback args from the message (msg => [...args])
 * @param {string} [replaySessionId] - Pass sessionId to on() for buffered message replay
 * @returns {Function} Handler registration function
 */
function createHandler(ctx, messageType, extractor, replaySessionId) {
  return (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === ctx.sessionId) {
        callback(...extractor(msg));
      }
    };
    ctx.ws.on(messageType, handler, replaySessionId);
    return () => ctx.ws.off(messageType, handler);
  };
}

/**
 * Create a handler that checks a custom matcher for filtering.
 * @param {Object} ctx - Context object { ws, sessionId }
 * @param {string} messageType - WS_MESSAGE_TYPES constant
 * @param {Function} matcher - Predicate to check session match (msg => boolean)
 * @param {Function} extractor - Extracts callback args from the message
 * @returns {Function} Handler registration function
 */
function createNestedHandler(ctx, messageType, matcher, extractor) {
  return (callback) => {
    const handler = (msg) => {
      if (matcher(msg)) {
        callback(...extractor(msg));
      }
    };
    ctx.ws.on(messageType, handler);
    return () => ctx.ws.off(messageType, handler);
  };
}

/**
 * Create subscribe/unsubscribe functions with reference counting.
 */
function createSubscriptionManager(ws, sessionId) {
  let thisInstanceSubscribed = false;

  const subscribe = () => {
    if (thisInstanceSubscribed) return;
    thisInstanceSubscribed = true;

    const count = sessionSubscriptionCounts.get(sessionId) || 0;
    sessionSubscriptionCounts.set(sessionId, count + 1);
    if (count === 0) {
      ws.send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
    }
  };

  const unsubscribe = () => {
    if (!thisInstanceSubscribed) return;
    thisInstanceSubscribed = false;

    const count = sessionSubscriptionCounts.get(sessionId) || 0;
    if (count <= 1) {
      sessionSubscriptionCounts.delete(sessionId);
      ws.send(WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION, { sessionId });
      ws.clearSessionBuffer(sessionId);
    } else {
      sessionSubscriptionCounts.set(sessionId, count - 1);
    }
  };

  return { subscribe, unsubscribe };
}

/**
 * Create core session event handlers (status, message, partial, error).
 */
function createCoreHandlers(ctx) {
  return {
    onStatus: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_STATUS, (msg) => [msg.status]),
    onMessage: createNestedHandler(ctx, WS_MESSAGE_TYPES.SESSION_MESSAGE,
      (msg) => msg.message?.sessionId === ctx.sessionId,
      (msg) => [msg.message]),
    onError: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_ERROR, (msg) => [msg.error]),
    onPartial: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_PARTIAL, (msg) => [msg.text]),
  };
}

/**
 * Create canvas, todos, work log, and thinking handlers.
 */
function createDataHandlers(ctx) {
  return {
    onCanvasAdd: createNestedHandler(ctx, WS_MESSAGE_TYPES.CANVAS_ADD,
      (msg) => msg.item?.sessionId === ctx.sessionId,
      (msg) => [msg.item]),
    onCanvasRemove: createHandler(ctx, WS_MESSAGE_TYPES.CANVAS_REMOVE, (msg) => [msg.itemId]),
    onTodosUpdate: createHandler(ctx, WS_MESSAGE_TYPES.TODOS_UPDATE, (msg) => [msg.todos, msg.conversationId]),
    onWorkLog: createNestedHandler(ctx, WS_MESSAGE_TYPES.SESSION_WORK_LOG,
      (msg) => msg.sessionId === ctx.sessionId && msg.log,
      (msg) => [msg.log]),
    onWorkLogsAssociated: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, (msg) => [msg.messageId]),
    onThinkingPartial: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, (msg) => [msg.thinking]),
  };
}

/**
 * Create session update, summary, and conversation handlers.
 */
function createSessionUpdateHandlers(ctx) {
  return {
    onSummaryUpdate: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, (msg) => [msg.summary]),
    onSummaryGenerating: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, (msg) => [msg.generating]),
    onSessionUpdate: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_UPDATED, (msg) => [msg.session]),
    onConversationCreated: createHandler(ctx, WS_MESSAGE_TYPES.CONVERSATION_CREATED, (msg) => [msg.conversation]),
    onConversationUpdated: createHandler(ctx, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, (msg) => [msg.conversation]),
    onConversationDeleted: createHandler(ctx, WS_MESSAGE_TYPES.CONVERSATION_DELETED, (msg) => [msg.conversationId, msg.newActiveConversation]),
    onUsageUpdate: createHandler(ctx, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, (msg) => [msg], ctx.sessionId),
    onChangesUpdate: createHandler(ctx, WS_MESSAGE_TYPES.CHANGES_UPDATE, (msg) => [msg.changeCount, msg.hasChanges]),
  };
}

/**
 * Create command run event handlers.
 */
function createCommandRunHandlers(ctx) {
  return {
    onCommandOutput: createHandler(ctx, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, (msg) => [msg.runId, msg.buttonId, msg.output]),
    onCommandComplete: createHandler(ctx, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, (msg) => [msg.runId, msg.buttonId, msg.exitCode, msg.output]),
    onCommandError: createHandler(ctx, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, (msg) => [msg.runId, msg.buttonId, msg.error || msg.message]),
    onCommandRunDeleted: createHandler(ctx, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, (msg) => [msg.runId, msg.buttonId]),
  };
}

/**
 * Subscribe to session updates
 * @param {string} sessionId
 */
export function useSessionSubscription(sessionId) {
  const ws = useWebSocket();
  const ctx = { ws, sessionId };

  const { subscribe, unsubscribe } = createSubscriptionManager(ws, sessionId);

  // Auto-cleanup on unmount
  onUnmounted(() => {
    unsubscribe();
  });

  return {
    subscribe,
    unsubscribe,
    ...createCoreHandlers(ctx),
    ...createDataHandlers(ctx),
    ...createSessionUpdateHandlers(ctx),
    ...createCommandRunHandlers(ctx),
  };
}

// Export for use in useWebSocket.js
export { sessionSubscriptionCounts };
