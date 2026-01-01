// Re-export everything from ws module for backward compatibility
export {
  WebSocketManager,
  webSocketManager,
  initWebSocket,
  broadcast,
  broadcastToSession,
  broadcastToProject,
  getWebSocketServer,
} from './ws/index.js';
