/**
 * Graceful shutdown for the Circus Chief HTTP server.
 *
 * Extracted from the entry point so the signal-handling behavior is
 * unit-testable: first signal drains, a repeated signal forces an immediate
 * exit, and a stalled close can never leave a live, non-listening process
 * behind.
 *
 * Signal contract:
 * - First SIGINT/SIGTERM: stop periodic services (bounded drain), terminate
 *   agent children and realtime connections, then close the HTTP server and
 *   exit 0.
 * - Second SIGINT/SIGTERM while a shutdown is already in flight: force-kill
 *   detached child process groups first, then exit immediately (130 for
 *   SIGINT, 143 for SIGTERM — the conventional 128+signum codes). A repeated
 *   Ctrl-C must never be silently swallowed while the drain is still running.
 * - Drain overruns a bounded force timeout: destroy remaining sockets,
 *   force-kill detached child process groups, and exit 1 so the port is
 *   always released and no orphaned command is left behind.
 */

/** Upper bound for the graceful drain before the process is forced out. */
export const SHUTDOWN_FORCE_TIMEOUT_MS = 6000;

/** Exit code when Ctrl-C is pressed again mid-shutdown (128 + SIGINT). */
export const SHUTDOWN_EXIT_SIGINT = 130;

/** Exit code when SIGTERM arrives again mid-shutdown (128 + SIGTERM). */
export const SHUTDOWN_EXIT_SIGTERM = 143;

function exitCodeForSignal(signal) {
  return signal === 'SIGINT' ? SHUTDOWN_EXIT_SIGINT : SHUTDOWN_EXIT_SIGTERM;
}

/**
 * @param {object} deps
 * @param {import('http').Server} deps.server - Listening HTTP server to close.
 * @param {() => Promise<void> | void} deps.stopPeriodicServices - Stop
 *   intervals/workers (includes the bounded lane-entry drain).
 * @param {() => void} [deps.terminateAgentChildren] - Graceful SIGTERM
 *   agent/child processes (e.g. commandRunner.shutdownAll()).
 * @param {() => void} [deps.forceTerminateAgentChildren] - Immediate forced
 *   termination of agent/child processes, run synchronously before a forced
 *   exit (e.g. commandRunner.shutdownAll({ force: true })). Must be
 *   synchronous and best-effort: no timer it schedules can run before the
 *   exit that follows. Defaults to terminateAgentChildren when omitted.
 * @param {() => void} [deps.closeRealtimeConnections] - Terminate realtime
 *   connections that would otherwise hold server.close() open
 *   (e.g. webSocketManager.close()).
 * @param {(code: number) => void} [deps.exit] - Process exit (injectable).
 * @param {{ log: Function, error: Function, warn: Function }} [deps.logger]
 * @returns {{ shutdown: (signal: string) => Promise<void>, install: () => void, isShuttingDown: () => boolean }}
 */
export function createShutdownHandler({
  server,
  stopPeriodicServices,
  terminateAgentChildren = () => {},
  forceTerminateAgentChildren,
  closeRealtimeConnections = () => {},
  exit = (code) => process.exit(code),
  logger = console,
}) {
  let shuttingDown = false;
  const forceCleanup = forceTerminateAgentChildren ?? terminateAgentChildren;

  // Detached command children survive the server's exit unless their process
  // group is killed first. Best-effort and synchronous: cleanup failures can
  // never block the final exit.
  function forceCleanupChildren() {
    try {
      forceCleanup();
    } catch {
      // Best effort: exit below regardless.
    }
  }

  async function shutdown(signal) {
    if (shuttingDown) {
      // A repeated Ctrl-C / SIGTERM during the drain is an explicit request
      // to stop waiting — kill detached children now (the graceful path is
      // still stuck in the drain and its escalation timer can never run
      // before this exit) and exit instead of swallowing the signal.
      logger.log(`${signal} received during shutdown, forcing exit`);
      forceCleanupChildren();
      exit(exitCodeForSignal(signal));
      return;
    }
    shuttingDown = true;
    logger.log(`${signal} received, shutting down gracefully`);

    const forceTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      // Release the port even with active connections outstanding, then exit.
      try {
        server.closeAllConnections?.();
      } catch {
        // Best effort: exit below regardless.
      }
      // Same guarantee as the repeated-signal path: detached children must
      // be force-killed before the exit, since graceful termination below
      // was never reached.
      forceCleanupChildren();
      exit(1);
    }, SHUTDOWN_FORCE_TIMEOUT_MS);
    forceTimeout.unref?.();

    // Drop idle keep-alive connections up front (Node >= 18.2) so the
    // trailing server.close() below cannot stall behind browsers holding
    // idle sockets while the bounded service drain runs.
    try {
      server.closeIdleConnections?.();
    } catch {
      // Older Node or a non-HTTP server double: server.close() still runs.
    }

    await stopPeriodicServices();

    // Kill child processes spawned by commandRunner
    terminateAgentChildren();

    // Close all realtime connections (must happen before server.close())
    closeRealtimeConnections();

    // Close HTTP server (now unblocked since idle and realtime connections
    // are gone)
    server.close(() => {
      logger.log('Server closed');
      exit(0);
    });
  }

  function install() {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  function isShuttingDown() {
    return shuttingDown;
  }

  return { shutdown, install, isShuttingDown };
}
