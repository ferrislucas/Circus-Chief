import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, Agent, get } from 'http';
import {
  createShutdownHandler,
  SHUTDOWN_FORCE_TIMEOUT_MS,
  SHUTDOWN_EXIT_SIGINT,
  SHUTDOWN_EXIT_SIGTERM,
} from './shutdown.js';

/**
 * Ctrl-C must always stop the server: the first signal drains gracefully, a
 * repeated signal forces an immediate exit, and a stalled close can never
 * leave the process alive past the force timeout.
 */
describe('createShutdownHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeDeps(server, overrides = {}) {
    return {
      server,
      stopPeriodicServices: vi.fn(async () => {}),
      terminateAgentChildren: vi.fn(),
      closeRealtimeConnections: vi.fn(),
      exit: vi.fn(),
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ...overrides,
    };
  }

  it('shuts down gracefully and exits 0 with an idle keep-alive connection open', async () => {
    const server = createServer((req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    // Hold an idle keep-alive socket open the way a browser tab does.
    const agent = new Agent({ keepAlive: true });
    await new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });

    const deps = makeDeps(server);
    const { shutdown } = createShutdownHandler(deps);
    await shutdown('SIGINT');

    expect(deps.stopPeriodicServices).toHaveBeenCalledOnce();
    expect(deps.terminateAgentChildren).toHaveBeenCalledOnce();
    expect(deps.closeRealtimeConnections).toHaveBeenCalledOnce();
    // server.close() completes on a later tick; the process exit follows it.
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));

    agent.destroy();
  });

  it('a repeated Ctrl-C during the drain forces an immediate exit instead of being swallowed', async () => {
    vi.useFakeTimers();
    // A server whose close() completes only after the test releases it, so
    // the first shutdown stays in flight while the second signal arrives.
    let releaseClose;
    const server = {
      close: vi.fn((cb) => { releaseClose = cb; }),
      closeIdleConnections: vi.fn(),
    };
    let releaseDrain;
    const deps = makeDeps(server, {
      stopPeriodicServices: vi.fn(() => new Promise((resolve) => { releaseDrain = resolve; })),
    });
    const { shutdown, isShuttingDown } = createShutdownHandler(deps);

    const first = shutdown('SIGINT');
    expect(isShuttingDown()).toBe(true);

    // Second Ctrl-C must exit NOW — without waiting for the drain or the
    // force timeout.
    await shutdown('SIGINT');
    expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGINT);

    releaseDrain();
    await vi.advanceTimersByTimeAsync(0);
    releaseClose();
    await first;
  });

  describe('forced shutdown child cleanup (Issue 1 P2)', () => {
    function makeBlockedDrain() {
      let releaseDrain;
      let drained = false;
      const stopPeriodicServices = vi.fn(() => new Promise((resolve) => {
        releaseDrain = () => { drained = true; resolve(); };
      }));
      return { stopPeriodicServices, releaseDrain: () => releaseDrain?.(), get drained() { return drained; } };
    }

    it('repeated SIGINT force-kills children synchronously before exit 130 while the drain stays blocked', async () => {
      vi.useFakeTimers();
      const events = [];
      const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
      const drain = makeBlockedDrain();
      const deps = makeDeps(server, {
        stopPeriodicServices: drain.stopPeriodicServices,
        forceTerminateAgentChildren: vi.fn(() => { events.push('force-cleanup'); }),
        exit: vi.fn((code) => { events.push(`exit:${code}`); }),
      });
      const { shutdown } = createShutdownHandler(deps);

      const first = shutdown('SIGINT');
      // Second Ctrl-C must clean up children BEFORE exiting, with no timer
      // advance and no drain release.
      await shutdown('SIGINT');

      expect(deps.forceTerminateAgentChildren).toHaveBeenCalledOnce();
      expect(events).toEqual(['force-cleanup', 'exit:130']);
      expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGINT);
      expect(drain.drained).toBe(false);
      expect(deps.terminateAgentChildren).not.toHaveBeenCalled();

      drain.releaseDrain();
      await first;
      vi.useRealTimers();
    });

    it('repeated SIGTERM force-kills children before exit 143', async () => {
      vi.useFakeTimers();
      const events = [];
      const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
      const drain = makeBlockedDrain();
      const deps = makeDeps(server, {
        stopPeriodicServices: drain.stopPeriodicServices,
        forceTerminateAgentChildren: vi.fn(() => { events.push('force-cleanup'); }),
        exit: vi.fn((code) => { events.push(`exit:${code}`); }),
      });
      const { shutdown } = createShutdownHandler(deps);

      const first = shutdown('SIGTERM');
      await shutdown('SIGTERM');

      expect(events).toEqual(['force-cleanup', 'exit:143']);
      expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGTERM);
      expect(drain.drained).toBe(false);

      drain.releaseDrain();
      await first;
      vi.useRealTimers();
    });

    it('mixed signals use the second signal exit code after forced cleanup', async () => {
      vi.useFakeTimers();
      const events = [];
      const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
      const drain = makeBlockedDrain();
      const deps = makeDeps(server, {
        stopPeriodicServices: drain.stopPeriodicServices,
        forceTerminateAgentChildren: vi.fn(() => { events.push('force-cleanup'); }),
        exit: vi.fn((code) => { events.push(`exit:${code}`); }),
      });
      const { shutdown } = createShutdownHandler(deps);

      const first = shutdown('SIGINT');
      await shutdown('SIGTERM');

      expect(events).toEqual(['force-cleanup', 'exit:143']);
      expect(drain.drained).toBe(false);

      drain.releaseDrain();
      await first;
      vi.useRealTimers();
    });

    it('force timeout force-kills children before exit 1', async () => {
      vi.useFakeTimers();
      const events = [];
      const server = {
        close: vi.fn(),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(() => { events.push('close-connections'); }),
      };
      const drain = makeBlockedDrain();
      const deps = makeDeps(server, {
        stopPeriodicServices: drain.stopPeriodicServices,
        forceTerminateAgentChildren: vi.fn(() => { events.push('force-cleanup'); }),
        exit: vi.fn((code) => { events.push(`exit:${code}`); }),
      });
      const { shutdown } = createShutdownHandler(deps);

      const pending = shutdown('SIGINT');
      await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_TIMEOUT_MS - 1);
      expect(deps.exit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(deps.exit).toHaveBeenCalledWith(1);
      // Cleanup must precede the exit call.
      const cleanupIndex = events.indexOf('force-cleanup');
      const exitIndex = events.findIndex((e) => e.startsWith('exit:'));
      expect(cleanupIndex).toBeGreaterThanOrEqual(0);
      expect(exitIndex).toBeGreaterThan(cleanupIndex);

      drain.releaseDrain();
      await pending;
      vi.useRealTimers();
    });

    it('forced cleanup failure cannot prevent exit', async () => {
      vi.useFakeTimers();
      const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
      const drain = makeBlockedDrain();
      const deps = makeDeps(server, {
        stopPeriodicServices: drain.stopPeriodicServices,
        forceTerminateAgentChildren: vi.fn(() => { throw new Error('kill failed'); }),
        exit: vi.fn(),
      });
      const { shutdown } = createShutdownHandler(deps);

      const first = shutdown('SIGINT');
      await shutdown('SIGINT');

      expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGINT);

      drain.releaseDrain();
      await first;
      vi.useRealTimers();
    });
  });

  it('a stalled close exits non-zero via the force timeout and destroys connections', async () => {
    vi.useFakeTimers();
    const server = {
      close: vi.fn(),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const deps = makeDeps(server);
    const { shutdown } = createShutdownHandler(deps);

    shutdown('SIGTERM');
    // Let the async drain run to server.close().
    await vi.advanceTimersByTimeAsync(0);
    expect(server.close).toHaveBeenCalledOnce();
    expect(deps.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_TIMEOUT_MS);
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
