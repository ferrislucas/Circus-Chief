import { WebSocketServer } from 'ws';
import { WS_MESSAGE_TYPES, parseMessage, createMessage } from '@claudetools/shared';

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const sessionSubscriptions = new Map();

let wss = null;

/**
 * Initialize WebSocket server
 * @param {import('http').Server} server
 * @returns {WebSocketServer}
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (data) => {
      const message = parseMessage(data.toString());
      if (!message) return;

      handleMessage(ws, message);
    });

    ws.on('close', () => {
      clients.delete(ws);
      // Remove from all session subscriptions
      for (const subscribers of sessionSubscriptions.values()) {
        subscribers.delete(ws);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}

/**
 * Handle incoming WebSocket message
 * @param {import('ws').WebSocket} ws
 * @param {Object} message
 */
function handleMessage(ws, message) {
  switch (message.type) {
    case WS_MESSAGE_TYPES.SUBSCRIBE_SESSION: {
      const { sessionId } = message;
      if (!sessionId) return;

      if (!sessionSubscriptions.has(sessionId)) {
        sessionSubscriptions.set(sessionId, new Set());
      }
      sessionSubscriptions.get(sessionId).add(ws);
      break;
    }

    case WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION: {
      const { sessionId } = message;
      if (!sessionId) return;

      const subscribers = sessionSubscriptions.get(sessionId);
      if (subscribers) {
        subscribers.delete(ws);
      }
      break;
    }
  }
}

/**
 * Broadcast message to all connected clients
 * @param {string} type
 * @param {Object} payload
 */
export function broadcast(type, payload) {
  const message = createMessage(type, payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(message);
    }
  }
}

/**
 * Broadcast message to clients subscribed to a session
 * @param {string} sessionId
 * @param {string} type
 * @param {Object} payload
 */
export function broadcastToSession(sessionId, type, payload) {
  const subscribers = sessionSubscriptions.get(sessionId);
  if (!subscribers) return;

  const message = createMessage(type, payload);
  for (const client of subscribers) {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(message);
    }
  }
}

/**
 * Get WebSocket server instance
 * @returns {WebSocketServer|null}
 */
export function getWebSocketServer() {
  return wss;
}
