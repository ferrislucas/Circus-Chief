import { createServer } from 'http';
import { createApp } from './app.js';
import { initDatabase } from './database.js';
import { initWebSocket } from './websocket.js';
import { DEFAULT_SERVER_PORT } from '@claudetools/shared';

const port = process.env.PORT || DEFAULT_SERVER_PORT;
const production = process.env.NODE_ENV === 'production';
const dbPath = process.env.DB_PATH || 'claudetools.db';

// Initialize database
initDatabase(dbPath);
console.log(`Database initialized: ${dbPath}`);

// Create Express app
const app = createApp({ production });

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket
initWebSocket(server);

// Start server on all interfaces
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/ws`);
});
