import { createServer } from 'http';
import { execSync } from 'child_process';
import { createApp } from './app.js';
import { initDatabase } from './database.js';
import { initWebSocket } from './websocket.js';
import { parseCliOptions } from './cli.js';
import { settings } from './db/index.js';
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

const { port, disableAnalytics } = parseCliOptions();
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

// Apply --no-analytics flag to persisted settings
if (disableAnalytics) {
  settings.setGeneralSettings({ disableAnalytics: true });
  console.log('Analytics disabled via --no-analytics flag');
}

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
  console.log(`Circus Chief running on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/ws`);
});
