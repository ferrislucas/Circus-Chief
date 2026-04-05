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

  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  #projectSubscriptions = new Map();

  /** @type {Map<string, Array<Object>>} */
  #usageUpdateBuffer = new Map();

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
        // Remove from all project subscriptions
        for (const subscribers of this.#projectSubscriptions.values()) {
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
    const handlers = {
      [WS_MESSAGE_TYPES.SUBSCRIBE_SESSION]: () => this.#handleSubscribeSession(ws, message),
      [WS_MESSAGE_TYPES.UNSUBSCRIBE_SESSION]: () => this.#handleUnsubscribeSession(ws, message),
      [WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT]: () => this.#handleSubscribeProject(ws, message),
      [WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT]: () => this.#handleUnsubscribeProject(ws, message),
    };
    handlers[message.type]?.();
  }

  #handleSubscribeSession(ws, message) {
    const { sessionId } = message;
    if (!sessionId) return;

    if (!this.#sessionSubscriptions.has(sessionId)) {
      this.#sessionSubscriptions.set(sessionId, new Set());
    }
    this.#sessionSubscriptions.get(sessionId).add(ws);
    this.#replayBufferedUsageUpdates(ws, sessionId);
  }

  #replayBufferedUsageUpdates(ws, sessionId) {
    const buffered = this.#usageUpdateBuffer.get(sessionId);
    if (!buffered || buffered.length === 0) return;

    for (const bufferedMsg of buffered) {
      const msg = createMessage(bufferedMsg.type, bufferedMsg);
      if (ws.readyState === 1) {
        ws.send(msg);
      }
    }
    this.#usageUpdateBuffer.delete(sessionId);
  }

  #handleUnsubscribeSession(ws, message) {
    const { sessionId } = message;
    if (!sessionId) return;
    this.#sessionSubscriptions.get(sessionId)?.delete(ws);
  }

  #handleSubscribeProject(ws, message) {
    const { projectId } = message;
    if (!projectId) return;

    if (!this.#projectSubscriptions.has(projectId)) {
      this.#projectSubscriptions.set(projectId, new Set());
    }
    this.#projectSubscriptions.get(projectId).add(ws);
  }

  #handleUnsubscribeProject(ws, message) {
    const { projectId } = message;
    if (!projectId) return;
    this.#projectSubscriptions.get(projectId)?.delete(ws);
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

    // Buffer SESSION_USAGE_UPDATE messages if no subscribers exist
    if (type === 'session:usage_update' && (!subscribers || subscribers.size === 0)) {
      if (!this.#usageUpdateBuffer.has(sessionId)) {
        this.#usageUpdateBuffer.set(sessionId, []);
      }
      const buffer = this.#usageUpdateBuffer.get(sessionId);
      buffer.push({ type, ...payload });
      // Keep reasonable buffer size (max 50 messages)
      if (buffer.length > 50) {
        buffer.shift();
      }
      return;
    }

    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = createMessage(type, payload);
    for (const client of subscribers) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(message);
      }
    }
  }

  /**
   * Broadcast message to clients subscribed to a project
   * @param {string} projectId - Project ID
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   */
  broadcastToProject(projectId, type, payload) {
    const subscribers = this.#projectSubscriptions.get(projectId);
    if (!subscribers || subscribers.size === 0) return;

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
   * Get project subscriptions
   * @returns {Map<string, Set<import('ws').WebSocket>>}
   */
  getProjectSubscriptions() {
    return this.#projectSubscriptions;
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
    this.#projectSubscriptions.clear();
    this.#usageUpdateBuffer.clear();
  }
}

// Singleton instance
export const webSocketManager = new WebSocketManager();
