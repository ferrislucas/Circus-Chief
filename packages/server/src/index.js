import { createServer } from 'http';
import { parseArgs } from 'node:util';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { createApp } from './app.js';
import { initDatabase } from './database.js';
import { initWebSocket } from './websocket.js';
import { DEFAULT_SERVER_PORT } from '@circuschief/shared';
import * as prStatusService from './services/prStatusService.js';
import * as systemMonitor from './services/systemMonitor.js';
import { schedulerService } from './services/schedulerService.js';
import * as sessionManager from './services/sessionManager.js';

/**
 * Validate Node.js environment at startup.
 * Warns if 'node' is not in PATH (common with nvm/fnm version managers).
 */
function validateNodeEnvironment() {
  try {
    execSync('node --version', { stdio: 'ignore' });
  } catch {
    console.warn('');
    console.warn('[Warning] "node" is not found in PATH.');
    console.warn('If using nvm/fnm/volta, ensure your shell is properly configured.');
    console.warn(`Current Node binary: ${process.execPath}`);
    console.warn('This will be used for child processes (Claude Code sessions).');
    console.warn('');
  }
}

const { values } = parseArgs({
  options: {
    port: {
      type: 'string',
      short: 'p',
      default: String(DEFAULT_SERVER_PORT),
    },
  },
});

const port = parseInt(values.port, 10);
process.env.PORT = String(port);
const production = process.env.NODE_ENV === 'production';
// Migration: fall back to legacy claudetools.db if circuschief.db doesn't exist
let dbPath = process.env.DB_PATH || 'circuschief.db';
if (!process.env.DB_PATH && !existsSync('circuschief.db') && existsSync('claudetools.db')) {
  console.log('[migration] Using legacy claudetools.db — rename to circuschief.db to suppress this message');
  dbPath = 'claudetools.db';
}

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Validate Node.js environment
validateNodeEnvironment();

// Initialize database
initDatabase(dbPath);
console.log(`Database initialized: ${dbPath}`);

// Create Express app
const app = createApp({ production });

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket for app
initWebSocket(server);

// Initialize and start scheduler service
schedulerService.initialize(sessionManager);
schedulerService.start();

// Start PR status polling service
prStatusService.start();

// Start system metrics broadcast service
systemMonitor.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  schedulerService.stop();
  prStatusService.stop();
  systemMonitor.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  schedulerService.stop();
  prStatusService.stop();
  systemMonitor.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server on all interfaces
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/ws`);
});
