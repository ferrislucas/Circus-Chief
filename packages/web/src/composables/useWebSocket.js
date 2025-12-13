import { ref, onUnmounted } from 'vue';
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY, parseMessage, createMessage, WS_MESSAGE_TYPES } from '@claudetools/shared';

let socket = null;
let reconnectTimeout = null;
let reconnectDelay = WS_RECONNECT_BASE_DELAY;
const listeners = new Map();
const isConnected = ref(false);

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
  };

  socket.onmessage = (event) => {
    const message = parseMessage(event.data);
    if (!message) return;

    const typeListeners = listeners.get(message.type);
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

function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close(1000);
    socket = null;
  }
}

function send(type, payload) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(createMessage(type, payload));
  }
}

function on(type, callback) {
  if (!listeners.has(type)) {
    listeners.set(type, new Set());
  }
  listeners.get(type).add(callback);
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
  };
}

/**
 * Subscribe to session updates
 * @param {string} sessionId
 */
export function useSessionSubscription(sessionId) {
  const { send, on, off } = useWebSocket();

  const subscribe = () => {
    send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
  };

  const unsubscribe = () => {
    send(WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION, { sessionId });
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
    const handler = (msg) => callback(msg.message);
    on(WS_MESSAGE_TYPES.SESSION_MESSAGE, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_MESSAGE, handler);
  };

  const onError = (callback) => {
    const handler = (msg) => callback(msg.error);
    on(WS_MESSAGE_TYPES.SESSION_ERROR, handler);
    return () => off(WS_MESSAGE_TYPES.SESSION_ERROR, handler);
  };

  const onCanvasAdd = (callback) => {
    const handler = (msg) => callback(msg.item);
    on(WS_MESSAGE_TYPES.CANVAS_ADD, handler);
    return () => off(WS_MESSAGE_TYPES.CANVAS_ADD, handler);
  };

  const onCanvasRemove = (callback) => {
    const handler = (msg) => callback(msg.itemId);
    on(WS_MESSAGE_TYPES.CANVAS_REMOVE, handler);
    return () => off(WS_MESSAGE_TYPES.CANVAS_REMOVE, handler);
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
    onError,
    onCanvasAdd,
    onCanvasRemove,
  };
}
