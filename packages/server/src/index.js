import { createServer } from 'http';
import { createApp, getViteProxy } from './app.js';
import { initDatabase } from './database.js';
import { initWebSocket } from './websocket.js';
import { DEFAULT_SERVER_PORT } from '@claudetools/shared';

const port = process.env.PORT || DEFAULT_SERVER_PORT;
const production = process.env.NODE_ENV === 'production';
const dbPath = process.env.DB_PATH || 'claudetools.db';

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize database
initDatabase(dbPath);
console.log(`Database initialized: ${dbPath}`);

// Create Express app
const app = createApp({ production });

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket for app
initWebSocket(server);

// In dev mode, handle Vite HMR WebSocket upgrades
if (!production) {
  const viteProxy = getViteProxy();
  if (viteProxy) {
    server.on('upgrade', (req, socket, head) => {
      // Only proxy non-app WebSocket connections (Vite HMR)
      if (!req.url.startsWith('/ws')) {
        viteProxy.upgrade(req, socket, head);
      }
    });
  }
}

// Start server on all interfaces
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/ws`);
});
