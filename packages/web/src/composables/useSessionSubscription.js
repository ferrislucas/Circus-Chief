import { onUnmounted } from 'vue';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { useWebSocket } from './useWebSocket.js';

// Reference counting for session subscriptions
// Prevents premature unsubscription when multiple components use the same session
const sessionSubscriptionCounts = new Map();

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

  const onStatus = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.status);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_STATUS, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_STATUS, handler);
  };

  const onMessage = (callback) => {
    const handler = (msg) => {
      // Filter by sessionId to avoid cross-session interference
      if (msg.message?.sessionId === sessionId) {
        callback(msg.message);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_MESSAGE, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_MESSAGE, handler);
  };

  const onError = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.error);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_ERROR, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_ERROR, handler);
  };

  const onCanvasAdd = (callback) => {
    const handler = (msg) => {
      if (msg.item?.sessionId === sessionId) {
        callback(msg.item);
      }
    };
    on(WS_MESSAGE_TYPES.CANVAS_ADD, handler);
    return () => off(WS_MESSAGE_TYPES.CANVAS_ADD, handler);
  };

  const onCanvasRemove = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.itemId);
      }
    };
    on(WS_MESSAGE_TYPES.CANVAS_REMOVE, handler);
    return () => off(WS_MESSAGE_TYPES.CANVAS_REMOVE, handler);
  };

  const onPartial = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.text);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_PARTIAL, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_PARTIAL, handler);
  };

  const onTodosUpdate = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.todos, msg.conversationId);
      }
    };
    on(WS_MESSAGE_TYPES.TODOS_UPDATE, handler);
    return () => off(WS_MESSAGE_TYPES.TODOS_UPDATE, handler);
  };

  const onWorkLog = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId && msg.log) {
        callback(msg.log);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_WORK_LOG, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_WORK_LOG, handler);
  };

  const onWorkLogsAssociated = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.messageId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, handler);
  };

  const onThinkingPartial = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.thinking);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, handler);
  };

  const onSummaryUpdate = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.summary);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, handler);
  };

  const onSummaryGenerating = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.generating);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_SUMMARY_GENERATING, handler);
  };

  const onSessionUpdate = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.session);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
  };

  const onConversationCreated = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.conversation);
      }
    };
    on(WS_MESSAGE_TYPES.CONVERSATION_CREATED, handler);
    return () => off(WS_MESSAGE_TYPES.CONVERSATION_CREATED, handler);
  };

  const onConversationUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.conversation);
      }
    };
    on(WS_MESSAGE_TYPES.CONVERSATION_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.CONVERSATION_UPDATED, handler);
  };

  const onConversationDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.conversationId, msg.newActiveConversation);
      }
    };
    on(WS_MESSAGE_TYPES.CONVERSATION_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.CONVERSATION_DELETED, handler);
  };

  const onUsageUpdate = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg);
      }
    };
    // Pass sessionId to on() so only this session's buffered messages are replayed
    on(WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, handler, sessionId);
    return () => off(WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, handler);
  };

  const onCommandOutput = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.runId, msg.buttonId, msg.output);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, handler);
  };

  const onCommandComplete = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.runId, msg.buttonId, msg.exitCode, msg.output);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, handler);
  };

  const onCommandError = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.runId, msg.buttonId, msg.error || msg.message);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, handler);
  };

  const onChangesUpdate = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.changeCount, msg.hasChanges);
      }
    };
    on(WS_MESSAGE_TYPES.CHANGES_UPDATE, handler);
    return () => off(WS_MESSAGE_TYPES.CHANGES_UPDATE, handler);
  };

  // Auto-cleanup on unmount
  onUnmounted(() => {
    unsubscribe();
  });

  return {
    subscribe,
    unsubscribe,
    onStatus,
    onMessage,
    onPartial,
    onError,
    onCanvasAdd,
    onCanvasRemove,
    onTodosUpdate,
    onWorkLog,
    onWorkLogsAssociated,
    onThinkingPartial,
    onSummaryUpdate,
    onSummaryGenerating,
    onSessionUpdate,
    onConversationCreated,
    onConversationUpdated,
    onConversationDeleted,
    onUsageUpdate,
    onCommandOutput,
    onCommandComplete,
    onCommandError,
    onChangesUpdate,
  };
}

// Export for use in useWebSocket.js
export { sessionSubscriptionCounts };
