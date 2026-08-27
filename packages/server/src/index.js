import { createServer } from 'http';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { createApp } from './app.js';
import { initDatabase, commandRuns, sessions } from './database.js';
import { initWebSocket, webSocketManager, setCommandRunOutputAuthorizer } from './websocket.js';
import { parseCliOptions } from './cli.js';
import { settings } from './db/index.js';
import * as prStatusService from './services/prStatusService.js';
import * as systemMonitor from './services/systemMonitor.js';
import { schedulerService } from './services/schedulerService.js';
import * as sessionManager from './services/sessionManager.js';
import { clearScheduledTimers } from './services/summaryService.js';
import { commandRunner } from './services/commandRunner.js';
import { getDefaultDbPath } from './config.js';
import { recoverOrphanedStartingSessions, recoverOrphanedRunningSessions, clearStalePendingAgentInput } from './services/sessionStartupRecovery.js';
import { startLaneEntryRetryWorker, stopLaneEntryRetryWorker } from './services/kanbanService.js';
import { formatKanbanInvariantReport } from './services/kanbanRecoveryService.js';
import { runStartupPreflight } from './services/startupPreflight.js';
import { setAutomationPreflightStatus } from './services/automationStatusService.js';
import { startKanbanOperationRetention, stopKanbanOperationRetention } from './services/kanbanOperationRetention.js';
import { startStreamWatchdog, stopStreamWatchdog } from './services/streamWatchdog.js';

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
const dbPath = process.env.DB_PATH || getDefaultDbPath();

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Validate Node.js environment
validateNodeEnvironment();

// Ensure the database directory exists
mkdirSync(dirname(dbPath), { recursive: true });

// Initialize database
initDatabase(dbPath);
setCommandRunOutputAuthorizer((runId, requestedSessionId) => {
  const run = commandRuns.getById(runId);
  const rootSessionId = sessions.getRootSessionId(requestedSessionId);
  return { allowed: Boolean(run && rootSessionId && run.sessionId === rootSessionId), highWater: run ? commandRuns.getHighWater(runId) : 0 };
});
console.log(`Database initialized: ${dbPath}`);
console.log(`VCR_MODE: ${process.env.VCR_MODE || '(unset)'}`);

// Boot order is load-bearing and must stay: recovery → preflight → workers.
recoverOrphanedStartingSessions();
// Agent processes never outlive the server, so any surviving 'running' row is
// an orphan — from a kill, or from a turn that unwound without recording an
// outcome. Recovery closes still-open roots as failed/cancelled (never
// 'succeeded') before preflight runs, so reconcileStuckOpenRuns() inside
// preflight sees terminal roots and can apply a declared exit — or complete
// any otherwise-stuck run — instead of skipping an open root. Recovery
// therefore cannot move a card or create a successor run ahead of the audit —
// see sessionStartupRecovery.js.
recoverOrphanedRunningSessions();
// promptStore.js's in-memory prompt queue is empty at this point in boot (no
// session code has run yet to repopulate it), so any pending_agent_input=1
// row left over from the previous process is unrecoverable and must be
// cleared now, before preflight or any client can read the stale flag.
clearStalePendingAgentInput();
// The broadcasts queued by the two recovery calls above are no-ops here:
// initWebSocket(server) has not run yet, so no clients exist to receive them.
// Do not start workers or drain the entry outbox until durable ownership has
// been normalized and independently audited. A bad lane configuration is a
// hard stop: selecting a fallback executor would reintroduce the retired mode.
const preflight = runStartupPreflight();
setAutomationPreflightStatus(preflight);
startKanbanOperationRetention();
startStreamWatchdog();
if (!preflight.workersEnabled) {
  console.error(formatKanbanInvariantReport(preflight.report));
  console.error('Kanban preflight failed; HTTP serving and unrelated scheduling remain available, but Kanban entry delivery is disabled');
} else {
  startLaneEntryRetryWorker();
}

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

// Scheduler readiness is independent of Kanban automation readiness. A bad
// board configuration must never strand unrelated scheduled sessions.
schedulerService.startIfEnabled(sessionManager);

// Start PR status polling service
prStatusService.start();

// Start system metrics broadcast service
systemMonitor.start();

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);

  // Safety net: the entry worker gets its documented five-second drain bound
  // before process exit is forced.
  const forceTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 6000);
  forceTimeout.unref();

  // Stop periodic services
  schedulerService.stop();
  await stopLaneEntryRetryWorker();
  stopKanbanOperationRetention();
  stopStreamWatchdog();
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
  console.log(`Circus Chief running on http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/ws`);
});
