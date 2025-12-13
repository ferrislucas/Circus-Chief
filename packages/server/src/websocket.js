import { WebSocketServer } from 'ws';
import { WS_MESSAGE_TYPES, parseMessage, createMessage } from '@claudetools/shared';

/**
 * WebSocket manager class for handling WebSocket connections and messaging
 */
export class WebSocketManager {
  /** @type {WebSocketServer|null} */
  #wss = null;

  /** @type {Set<import('ws').WebSocket>} */
  #clients = new Set();

  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  #sessionSubscriptions = new Map();

  /**
   * Initialize WebSocket server
   * @param {import('http').Server} server - HTTP server to attach to
   * @returns {WebSocketServer}
   */
  init(server) {
    this.#wss = new WebSocketServer({ server, path: '/ws' });

    this.#wss.on('connection', (ws) => {
      this.#clients.add(ws);

      ws.on('message', (data) => {
        const message = parseMessage(data.toString());
        if (!message) return;

        this.#handleMessage(ws, message);
      });

      ws.on('close', () => {
        this.#clients.delete(ws);
        // Remove from all session subscriptions
        for (const subscribers of this.#sessionSubscriptions.values()) {
          subscribers.delete(ws);
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    return this.#wss;
  }

  /**
   * Handle incoming WebSocket message
   * @param {import('ws').WebSocket} ws
   * @param {Object} message
   */
  #handleMessage(ws, message) {
    switch (message.type) {
      case WS_MESSAGE_TYPES.SUBSCRIBE_SESSION: {
        const { sessionId } = message;
        if (!sessionId) return;

        if (!this.#sessionSubscriptions.has(sessionId)) {
          this.#sessionSubscriptions.set(sessionId, new Set());
        }
        this.#sessionSubscriptions.get(sessionId).add(ws);
        break;
      }

      case WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION: {
        const { sessionId } = message;
        if (!sessionId) return;

        const subscribers = this.#sessionSubscriptions.get(sessionId);
        if (subscribers) {
          subscribers.delete(ws);
        }
        break;
      }
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   */
  broadcast(type, payload) {
    const message = createMessage(type, payload);
    for (const client of this.#clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(message);
      }
    }
  }

  /**
   * Broadcast message to clients subscribed to a session
   * @param {string} sessionId - Session ID
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   */
  broadcastToSession(sessionId, type, payload) {
    const subscribers = this.#sessionSubscriptions.get(sessionId);
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
  getServer() {
    return this.#wss;
  }

  /**
   * Get all connected clients
   * @returns {Set<import('ws').WebSocket>}
   */
  getClients() {
    return this.#clients;
  }

  /**
   * Get session subscriptions
   * @returns {Map<string, Set<import('ws').WebSocket>>}
   */
  getSessionSubscriptions() {
    return this.#sessionSubscriptions;
  }

  /**
   * Close the WebSocket server
   */
  close() {
    if (this.#wss) {
      this.#wss.close();
      this.#wss = null;
    }
    this.#clients.clear();
    this.#sessionSubscriptions.clear();
  }
}

// Singleton instance
const webSocketManager = new WebSocketManager();

// Legacy function exports for backward compatibility

/**
 * Initialize WebSocket server
 * @param {import('http').Server} server
 * @returns {WebSocketServer}
 */
export function initWebSocket(server) {
  return webSocketManager.init(server);
}

/**
 * Broadcast message to all connected clients
 * @param {string} type
 * @param {Object} payload
 */
export function broadcast(type, payload) {
  webSocketManager.broadcast(type, payload);
}

/**
 * Broadcast message to clients subscribed to a session
 * @param {string} sessionId
 * @param {string} type
 * @param {Object} payload
 */
export function broadcastToSession(sessionId, type, payload) {
  webSocketManager.broadcastToSession(sessionId, type, payload);
}

/**
 * Get WebSocket server instance
 * @returns {WebSocketServer|null}
 */
export function getWebSocketServer() {
  return webSocketManager.getServer();
}

// Export the manager instance
export { webSocketManager };
