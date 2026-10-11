import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, Agent, get } from 'http';
import {
  createShutdownHandler,
  SHUTDOWN_FORCE_TIMEOUT_MS,
  SHUTDOWN_EXIT_SIGINT,
  SHUTDOWN_EXIT_SIGTERM,
} from './shutdown.js';
import {
  combineForcedCleanup,
  forceStopMuseUsageProbe,
  stopMuseUsageProbe,
  _setActiveMuseUsageProbeForTests,
} from './services/museUsageProbeInstance.js';

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

  describe('muse probe shutdown composition (Issue 19)', () => {
    function controllableMuseProbe() {
      let resolveCleanup;
      const cleanup = new Promise((resolve) => { resolveCleanup = resolve; });
      const probe = {
        trigger: vi.fn(),
        stop: vi.fn(() => cleanup),
        forceKillOwnedGroup: vi.fn(),
      };
      _setActiveMuseUsageProbeForTests(probe, null);
      return { probe, resolveCleanup, cleanup };
    }

    it('graceful shutdown waits for muse probe cleanup before closing and exiting 0', async () => {
      vi.useFakeTimers();
      const muse = controllableMuseProbe();
      try {
        const server = {
          close: vi.fn((cb) => { cb?.(); }),
          closeIdleConnections: vi.fn(),
        };
        const deps = makeDeps(server, {
          // Entry-point composition (index.js): the periodic-services
          // drain awaits the muse probe's cleanup promise.
          stopPeriodicServices: () => stopMuseUsageProbe(),
        });
        const { shutdown } = createShutdownHandler(deps);
        const pending = shutdown('SIGTERM');
        try {
          await vi.advanceTimersByTimeAsync(0);
          // The HTTP server can close immediately, but neither the close
          // nor the process exit may proceed until probe cleanup settles.
          expect(muse.probe.stop).toHaveBeenCalledTimes(1);
          expect(server.close).not.toHaveBeenCalled();
          expect(deps.exit).not.toHaveBeenCalled();
          muse.resolveCleanup();
          await pending;
          expect(server.close).toHaveBeenCalledOnce();
          expect(deps.exit).toHaveBeenCalledWith(0);
        } finally {
          // Never strand the draining probe behind a failed assertion.
          muse.resolveCleanup();
          await pending.catch(() => {});
        }
      } finally {
        _setActiveMuseUsageProbeForTests(null);
        vi.useRealTimers();
      }
    });

    it('repeated signal force-kills muse groups synchronously while the lane drain stays blocked', async () => {
      vi.useFakeTimers();
      const muse = controllableMuseProbe();
      try {
        const events = [];
        let releaseDrain;
        const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
        const deps = makeDeps(server, {
          stopPeriodicServices: vi.fn(() => new Promise((resolve) => { releaseDrain = resolve; })),
          // Entry-point composition (index.js): forced exits run the
          // command-runner and muse forced cleanups together.
          forceTerminateAgentChildren: combineForcedCleanup(
            () => { events.push('command-force'); },
            () => { events.push('muse-force'); forceStopMuseUsageProbe(); },
          ),
        });
        const { shutdown } = createShutdownHandler(deps);
        const first = shutdown('SIGINT');
        // The probe is still active: the lane-entry drain never reached it.
        await shutdown('SIGINT');
        expect(events).toEqual(['command-force', 'muse-force']);
        expect(muse.probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
        expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGINT);
        releaseDrain();
        muse.resolveCleanup();
        await first;
      } finally {
        _setActiveMuseUsageProbeForTests(null);
        vi.useRealTimers();
      }
    });

    it('repeated signal force-kills a draining muse probe while the lane drain stays blocked', async () => {
      vi.useFakeTimers();
      const muse = controllableMuseProbe();
      try {
        let releaseDrain;
        const drainGate = new Promise((resolve) => { releaseDrain = resolve; });
        const commandRunnerForce = vi.fn();
        const server = { close: vi.fn(), closeIdleConnections: vi.fn() };
        const deps = makeDeps(server, {
          // The lane-entry drain starts muse stop, then stays blocked: the
          // probe is draining when the repeated signal arrives.
          stopPeriodicServices: vi.fn(async () => {
            void stopMuseUsageProbe();
            await drainGate;
          }),
          forceTerminateAgentChildren: combineForcedCleanup(
            commandRunnerForce,
            () => forceStopMuseUsageProbe(),
          ),
        });
        const { shutdown } = createShutdownHandler(deps);
        const first = shutdown('SIGTERM');
        try {
          await vi.advanceTimersByTimeAsync(0);
          expect(muse.probe.stop).toHaveBeenCalledTimes(1);
          await shutdown('SIGTERM');
          expect(commandRunnerForce).toHaveBeenCalledTimes(1);
          expect(muse.probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
          expect(deps.exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_SIGTERM);
          releaseDrain();
          muse.resolveCleanup();
          await first;
        } finally {
          // Never strand the blocked drain or the draining probe.
          releaseDrain?.();
          muse.resolveCleanup();
          await first.catch(() => {});
        }
      } finally {
        _setActiveMuseUsageProbeForTests(null);
        vi.useRealTimers();
      }
    });

    it('force timeout runs command and muse forced cleanup with independent error handling before exit 1', async () => {
      vi.useFakeTimers();
      try {
        const events = [];
        const server = {
          close: vi.fn(),
          closeIdleConnections: vi.fn(),
          closeAllConnections: vi.fn(),
        };
        let releaseDrain;
        const deps = makeDeps(server, {
          stopPeriodicServices: vi.fn(() => new Promise((resolve) => { releaseDrain = resolve; })),
          forceTerminateAgentChildren: combineForcedCleanup(
            () => { events.push('command'); throw new Error('command boom'); },
            () => { events.push('muse'); throw new Error('muse boom'); },
          ),
        });
        const { shutdown } = createShutdownHandler(deps);
        const pending = shutdown('SIGINT');
        await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_TIMEOUT_MS);
        expect(events).toEqual(['command', 'muse']);
        expect(deps.exit).toHaveBeenCalledWith(1);
        releaseDrain();
        await pending;
      } finally {
        vi.useRealTimers();
      }
    });

    it('force timeout still runs the command path when the muse path throws first', async () => {
      vi.useFakeTimers();
      try {
        const events = [];
        const server = {
          close: vi.fn(),
          closeIdleConnections: vi.fn(),
          closeAllConnections: vi.fn(),
        };
        let releaseDrain;
        const deps = makeDeps(server, {
          stopPeriodicServices: vi.fn(() => new Promise((resolve) => { releaseDrain = resolve; })),
          forceTerminateAgentChildren: combineForcedCleanup(
            () => { events.push('muse'); throw new Error('muse boom'); },
            () => { events.push('command'); },
          ),
        });
        const { shutdown } = createShutdownHandler(deps);
        const pending = shutdown('SIGINT');
        await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_TIMEOUT_MS);
        expect(events).toEqual(['muse', 'command']);
        expect(deps.exit).toHaveBeenCalledWith(1);
        releaseDrain();
        await pending;
      } finally {
        vi.useRealTimers();
      }
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
