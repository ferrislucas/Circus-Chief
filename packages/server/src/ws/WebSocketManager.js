import { WebSocketServer } from 'ws';
import { WS_MESSAGE_TYPES, parseMessage, createMessage } from '@circuschief/shared';
import { commandOutputMetrics, COMMAND_OUTPUT_METRICS } from '../services/commandOutputMetrics.js';

const OUTPUT_SOCKET_HIGH_WATER_BYTES = 256 * 1024;

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

  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  #commandRunOutputSubscriptions = new Map();
  #outputResyncRequired = new WeakMap();
  #commandRunOutputAuthorizer = null;

  setCommandRunOutputAuthorizer(authorizer) {
    this.#commandRunOutputAuthorizer = authorizer;
  }

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
        for (const [runId, subscribers] of this.#commandRunOutputSubscriptions) {
          subscribers.delete(ws);
          commandOutputMetrics.setGauge(`${COMMAND_OUTPUT_METRICS.OUTPUT_SUBSCRIBERS}:${runId}`, subscribers.size);
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
      [WS_MESSAGE_TYPES.SUBSCRIBE_COMMAND_RUN_OUTPUT]: () => this.#handleSubscribeCommandRunOutput(ws, message),
      [WS_MESSAGE_TYPES.UNSUBSCRIBE_COMMAND_RUN_OUTPUT]: () => this.#handleUnsubscribeCommandRunOutput(ws, message),
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

  #handleSubscribeCommandRunOutput(ws, message) {
    const { runId, sessionId } = message;
    const authorization = runId && sessionId && this.#commandRunOutputAuthorizer?.(runId, sessionId);
    // Deliberately return the same generic response for missing and cross-root runs.
    if (!authorization?.allowed) {
      if (ws.readyState === 1) ws.send(createMessage(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT_RESYNC_REQUIRED, { runId }));
      return;
    }
    if (!this.#commandRunOutputSubscriptions.has(runId)) this.#commandRunOutputSubscriptions.set(runId, new Set());
    this.#commandRunOutputSubscriptions.get(runId).add(ws);
    commandOutputMetrics.setGauge(`${COMMAND_OUTPUT_METRICS.OUTPUT_SUBSCRIBERS}:${runId}`, this.#commandRunOutputSubscriptions.get(runId).size);
    if (ws.readyState === 1) ws.send(createMessage(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT_SUBSCRIBED, {
      runId, highWater: authorization.highWater,
    }));
  }

  #handleUnsubscribeCommandRunOutput(ws, message) {
    if (!message.runId) return;
    const subscribers = this.#commandRunOutputSubscriptions.get(message.runId);
    subscribers?.delete(ws);
    commandOutputMetrics.setGauge(`${COMMAND_OUTPUT_METRICS.OUTPUT_SUBSCRIBERS}:${message.runId}`, subscribers?.size || 0);
  }

  /** Send a persisted output chunk to explicit viewers only. */
  broadcastCommandRunOutput(runId, chunk) {
    const subscribers = this.#commandRunOutputSubscriptions.get(runId);
    if (!subscribers?.size) return;
    const message = createMessage(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId, sequence: chunk.sequence, content: chunk.content });
    commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.OUTPUT_EVENTS);
    for (const client of subscribers) {
      if (client.readyState !== 1) continue;
      if (client.bufferedAmount >= OUTPUT_SOCKET_HIGH_WATER_BYTES) {
        commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.BACKPRESSURE_EVENTS);
        const pending = this.#outputResyncRequired.get(client) || new Set();
        if (!pending.has(runId)) {
          pending.add(runId);
          this.#outputResyncRequired.set(client, pending);
          commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.OUTPUT_RESYNCS);
          client.send(createMessage(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT_RESYNC_REQUIRED, { runId }));
        }
        continue;
      }
      this.#outputResyncRequired.get(client)?.delete(runId);
      client.send(message);
      commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.OUTPUT_BYTES_SENT, Buffer.byteLength(message));
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   */
  broadcast(type, payload) {
    this.#recordLifecycleEvent(type);
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
    this.#recordLifecycleEvent(type);
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
    this.#recordLifecycleEvent(type);
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

  /** Broadcast one serialized frame to the union of session and project subscribers. */
  broadcastToSessionAndProject(sessionId, projectId, type, payload) {
    this.#recordLifecycleEvent(type);
    const subscribers = new Set([
      ...(this.#sessionSubscriptions.get(sessionId) || []),
      ...(this.#projectSubscriptions.get(projectId) || []),
    ]);
    if (subscribers.size === 0) return;

    // Scope identifiers are authoritative; a caller payload must not be able
    // to redirect a frame to a different session or project.
    const message = createMessage(type, { ...payload, sessionId, projectId });
    for (const client of subscribers) {
      if (client.readyState === 1) client.send(message);
    }
  }

  /**
   * Get WebSocket server instance
   * @returns {WebSocketServer|null}
   */
  getServer() {
    return this.#wss;
  }

  #recordLifecycleEvent(type) {
    if ([
      WS_MESSAGE_TYPES.COMMAND_RUN_STARTED,
      WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE,
      WS_MESSAGE_TYPES.COMMAND_RUN_ERROR,
      WS_MESSAGE_TYPES.COMMAND_RUN_KILLED,
      WS_MESSAGE_TYPES.COMMAND_RUN_DELETED,
    ].includes(type)) commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.LIFECYCLE_EVENTS);
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
      // Terminate all connected clients first so their underlying TCP
      // sockets close, unblocking server.close() during shutdown.
      for (const client of this.#wss.clients) {
        client.terminate();
      }
      this.#wss.close();
      this.#wss = null;
    }
    this.#clients.clear();
    this.#sessionSubscriptions.clear();
    this.#projectSubscriptions.clear();
    this.#commandRunOutputSubscriptions.clear();
    this.#usageUpdateBuffer.clear();
  }
}

// Singleton instance
export const webSocketManager = new WebSocketManager();
