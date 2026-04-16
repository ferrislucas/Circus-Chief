import { createServer } from 'http';
import { parseArgs } from 'node:util';
import { execSync } from 'child_process';
import { createApp } from './app.js';
import { initDatabase } from './database.js';
import { initWebSocket, webSocketManager } from './websocket.js';
import { DEFAULT_SERVER_PORT } from '@circuschief/shared';
import * as prStatusService from './services/prStatusService.js';
import * as systemMonitor from './services/systemMonitor.js';
import { schedulerService } from './services/schedulerService.js';
import * as sessionManager from './services/sessionManager.js';
import { clearScheduledTimers } from './services/summaryService.js';
import { commandRunner } from './services/commandRunner.js';

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
const dbPath = process.env.DB_PATH || 'circuschief.db';

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
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);

  // Safety net: force exit after 5 seconds
  const forceTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 5000);
  forceTimeout.unref();

  // Stop periodic services
  schedulerService.stop();
  prStatusService.stop();
  systemMonitor.stop();

  // Clear dangling timers from summary service
  clearScheduledTimers();

  // Kill child processes spawned by commandRunner
  commandRunner.shutdownAll();

  // Close all WebSocket connections (must happen before server.close())
  webSocketManager.close();

  // Close HTTP server (now unblocked since WS clients are terminated)
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server on all interfaces
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${port}/ws`);
});
