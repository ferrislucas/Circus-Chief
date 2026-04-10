import { ref } from 'vue';
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY, parseMessage, createMessage, WS_MESSAGE_TYPES } from '@claudetools/shared';
import { sessionSubscriptionCounts } from './useSessionSubscription.js';
import { projectSubscriptionIds } from './useProjectSubscription.js';

let socket = null;
let reconnectTimeout = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
let hasConnectedBefore = false;
const listeners = new Map();
const isConnected = ref(false);
const connectionStatus = ref('disconnected'); // 'connected' | 'disconnected' | 'reconnecting'
const reconnectAttempt = ref(0);
// Buffer for messages that arrive before handlers are registered
// Specifically buffers SESSION_USAGE_UPDATE messages to prevent loss during subscription lag
const messageBuffer = new Map(); // Map of sessionId -> array of buffered messages
// Queue for outbound messages to send once connected
const outboundQueue = [];
// Reconnect callbacks - fired when WebSocket reconnects (not on initial connect)
const reconnectCallbacks = new Set();

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
    connectionStatus.value = 'connected';
    reconnectAttempt.value = 0;
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
    if (event.code === 1000) {
      connectionStatus.value = 'disconnected';
      return;
    }

    // Abnormal close — schedule reconnect
    connectionStatus.value = 'reconnecting';
    reconnectAttempt.value++;

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
        // Explicitly set reconnecting status since onclose won't fire
        // (we nulled it above to prevent the reconnect loop)
        connectionStatus.value = 'reconnecting';
        reconnectAttempt.value++;
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
    connectionStatus,
    reconnectAttempt,
    send,
    on,
    off,
    disconnect,
    clearSessionBuffer,
    onReconnect,
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
  const { send: wsSend } = useWebSocket();

  // If socket is already open, send immediately
  if (socket?.readyState === WebSocket.OPEN) {
    wsSend(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
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

// Re-export subscription functions from separate modules
export { useSessionSubscription } from './useSessionSubscription.js';
export { useProjectSubscription } from './useProjectSubscription.js';
export { useGlobalSessionSubscription } from './useGlobalSessionSubscription.js';
