export { WebSocketManager, webSocketManager } from './WebSocketManager.js';

// Legacy function exports for backward compatibility
import { webSocketManager } from './WebSocketManager.js';

/**
 * Initialize WebSocket server
 * @param {import('http').Server} server
 * @returns {import('ws').WebSocketServer}
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
 * Broadcast message to clients subscribed to a project
 * @param {string} projectId
 * @param {string} type
 * @param {Object} payload
 */
export function broadcastToProject(projectId, type, payload) {
  webSocketManager.broadcastToProject(projectId, type, payload);
}

/**
 * Get WebSocket server instance
 * @returns {import('ws').WebSocketServer|null}
 */
export function getWebSocketServer() {
  return webSocketManager.getServer();
}
