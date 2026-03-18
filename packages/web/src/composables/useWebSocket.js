import { ref, onUnmounted } from 'vue';
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY, parseMessage, createMessage, WS_MESSAGE_TYPES } from '@claudetools/shared';

let socket = null;
let reconnectTimeout = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let hasConnectedBefore = false;
const listeners = new Map();
const isConnected = ref(false);
// Buffer for messages that arrive before handlers are registered
// Specifically buffers SESSION_USAGE_UPDATE messages to prevent loss during subscription lag
const messageBuffer = new Map(); // Map of sessionId -> array of buffered messages
// Queue for outbound messages to send once connected
const outboundQueue = [];
// Reconnect callbacks - fired when WebSocket reconnects (not on initial connect)
const reconnectCallbacks = new Set();
// Track active project subscriptions for re-subscription on reconnect
const projectSubscriptionIds = new Set();

function getWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(getWebSocketUrl());

  socket.onopen = () => {
    console.log('WebSocket connected');
    isConnected.value = true;
    reconnectDelay = WS_RECONNECT_BASE_DELAY;

    // Flush queued outbound messages
    while (outboundQueue.length > 0) {
      const msg = outboundQueue.shift();
      socket.send(msg);
    }

    // Re-subscribe to all tracked sessions
    for (const sessionId of sessionSubscriptionCounts.keys()) {
      socket.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId }));
    }

    // Re-subscribe to all tracked projects
    for (const projectId of projectSubscriptionIds) {
      socket.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT, { projectId }));
    }

    // Notify reconnect listeners (only on RE-connections, not the initial connect)
    if (hasConnectedBefore) {
      for (const cb of reconnectCallbacks) {
        cb();
      }
    }
    hasConnectedBefore = true;
  };

  socket.onmessage = (event) => {
    const message = parseMessage(event.data);
    if (!message) return;

    const typeListeners = listeners.get(message.type);

    // Buffer SESSION_USAGE_UPDATE messages if no handlers are registered yet
    // This prevents message loss during subscription lag
    if (message.type === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && (!typeListeners || typeListeners.size === 0)) {
      const sessionId = message.sessionId;
      if (!messageBuffer.has(sessionId)) {
        messageBuffer.set(sessionId, []);
      }
      messageBuffer.get(sessionId).push(message);
      // Keep buffer size reasonable (max 100 messages per session)
      if (messageBuffer.get(sessionId).length > 100) {
        messageBuffer.get(sessionId).shift();
      }
      return;
    }

    if (typeListeners) {
      for (const callback of typeListeners) {
        callback(message);
      }
    }
  };

  socket.onclose = (event) => {
    console.log('WebSocket closed', event.code);
    isConnected.value = false;
    socket = null;

    // Don't reconnect on clean close
    if (event.code === 1000) return;

    // Exponential backoff reconnection
    reconnectTimeout = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, WS_RECONNECT_MAX_DELAY);
      connect();
    }, reconnectDelay);
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Detect wake-from-sleep: when the page becomes visible, check if the WebSocket
// is dead (null or zombie) and force a clean reconnect. The onopen handler above
// will re-subscribe all tracked sessions and projects automatically.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Kill zombie socket so connect() creates a fresh one
        if (socket) {
          socket.onclose = null; // prevent reconnect loop from old socket
          socket.close();
          socket = null;
        }
        connect();
      }
    }
  });
}

/**
 * Register a callback that fires when the WebSocket reconnects
 * (not on the initial connection, only on subsequent re-connections)
 * @param {Function} callback - The callback to fire on reconnect
 * @returns {Function} - Cleanup function to remove the callback
 */
function onReconnect(callback) {
  reconnectCallbacks.add(callback);
  return () => reconnectCallbacks.delete(callback);
}

function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close(1000);
    socket = null;
  }
  // Clear all message buffers on disconnect
  messageBuffer.clear();
  // Clear outbound queue on disconnect
  outboundQueue.length = 0;
}

/**
 * Clear the message buffer for a specific session
 * @param {string} sessionId - The session ID to clear buffer for
 */
function clearSessionBuffer(sessionId) {
  messageBuffer.delete(sessionId);
}

function send(type, payload) {
  const message = createMessage(type, payload);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(message);
  } else {
    // Queue message to send when socket connects
    outboundQueue.push(message);
    // Ensure we're trying to connect
    if (!socket) {
      connect();
    }
  }
}

function on(type, callback, sessionId = null) {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  listeners.get(type).add(callback);

  // If registering a SESSION_USAGE_UPDATE handler with a sessionId, replay buffered messages only for that session
  if (type === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && sessionId) {
    // Only replay messages for the specific session
    const bufferedMessages = messageBuffer.get(sessionId);
    if (bufferedMessages && bufferedMessages.length > 0) {
      for (const message of bufferedMessages) {
        callback(message);
      }
      // Only clear THIS session's buffer
      messageBuffer.delete(sessionId);
    }
  }
}

function off(type, callback) {
  const typeListeners = listeners.get(type);
  if (typeListeners) {
    typeListeners.delete(callback);
  }
}

/**
 * WebSocket connection composable
 */
export function useWebSocket() {
  // Connect on first use
  if (!socket) {
    connect();
  }

  return {
    isConnected,
    send,
    on,
    off,
    disconnect,
    clearSessionBuffer,
    onReconnect,
  };
}

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

  const onCommandRunDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.sessionId === sessionId) {
        callback(msg.runId, msg.buttonId);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
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
    onCommandRunDeleted,
    onChangesUpdate,
  };
}

/**
 * Ensure the WebSocket is connected and subscribed to a session
 * Handles zombie sockets (socket object exists but TCP is dead) by killing
 * them and creating a fresh connection. Uses the outbound queue + send() helper
 * instead of monkey-patching socket.onopen.
 * @param {string} sessionId - The session ID to subscribe to
 * @returns {Promise<void>} - Resolves when subscription message is sent
 */
export async function ensureSubscribed(sessionId) {
  const { send } = useWebSocket();

  // If socket is already open, send immediately
  if (socket?.readyState === WebSocket.OPEN) {
    send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
    return;
  }

  // Kill zombie sockets - not OPEN and not actively CONNECTING
  if (socket && socket.readyState !== WebSocket.CONNECTING) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }

  // Use the send() helper which queues the message if not connected
  // and triggers connect() if socket is null. The queued message
  // will be flushed automatically when socket.onopen fires.
  send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });

  // Wait for connection to confirm the message was sent
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Subscription timeout for session ${sessionId}`));
    }, 5000);

    const checkConnection = () => {
      if (isConnected.value) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(checkConnection, 100);
      }
    };
    checkConnection();
  });
}

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

  const onCommandRunDeleted = (callback) => {
    const handler = (msg) => {
      if (msg.projectId === projectId) {
        callback(msg.runId, msg.sessionId, msg.buttonId);
      }
    };
    on(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
    return () => off(WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, handler);
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
    onCommandRunDeleted,
  };
}

/**
 * Subscribe to all session updates globally (across all projects)
 * Used for views like ActiveSessionsView that show sessions from multiple projects
 */
export function useGlobalSessionSubscription() {
  const { on, off } = useWebSocket();

  // Listen for session created across ALL projects
  const onSessionCreated = (callback) => {
    const handler = (msg) => {
      if (msg.session) {
        callback(msg.session, msg.projectId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_CREATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_CREATED, handler);
  };

  // Listen for session updated across ALL projects
  const onSessionUpdated = (callback) => {
    const handler = (msg) => {
      if (msg.session) {
        callback(msg.session, msg.projectId);
      }
    };
    on(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_UPDATED, handler);
  };

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
