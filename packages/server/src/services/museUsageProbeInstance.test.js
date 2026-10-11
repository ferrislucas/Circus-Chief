import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuseUsageProbe } from './museUsageProbe.js';
import { getProviderAllowanceObserver } from './providerAllowanceServiceInstance.js';
import {
  MUSE_USAGE_PROBE_HEARTBEAT_MS,
  combineForcedCleanup,
  forceStopMuseUsageProbe,
  heartbeatTick,
  startMuseUsageProbe,
  stopMuseUsageProbe,
  triggerMuseUsageProbe,
  _setActiveMuseUsageProbeForTests,
} from './museUsageProbeInstance.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeProbe() {
  return { trigger: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(undefined) };
}

const museSessionRepo = (session) => ({ getById: () => session });
const executingRepo = (executing) => ({ hasExecutingAgentType: () => executing });

const META_PROVIDERS = {
  getEnabledForAllowances: () => [{ id: 'meta-default', kind: 'meta', isBuiltIn: true, enabled: true }],
  getById: (id) => ({
    id, kind: 'meta', isBuiltIn: true, enabled: true,
    models: [{ modelId: 'muse-spark-1.3', enabled: true }],
  }),
};
const PROBE_SETTINGS = { getMuseProbeSettings: () => ({ probeModel: 'muse-spark-1.3' }) };

/**
 * Minimal fake `muse serve`: answers the handshake and session start, then
 * hangs the turn so overlapping triggers share one in-flight probe. No real
 * `muse` process is ever spawned.
 */
/**
 * Absent-group signal double (Issue 17): emitter-only fake children own no
 * real OS process group, so every group signal throws ESRCH and teardown
 * falls back to the mocked direct `child.kill`.
 */
function createAbsentGroupDouble() {
  return vi.fn(() => {
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  });
}

function createHangingServe(spawned) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
    pid: 4242,
  });
  child.stdin = {
    write: vi.fn((chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.method === 'initialize') {
          child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} })}\n`));
        } else if (frame.method === 'session/start') {
          child.stdout.emit('data', Buffer.from(`${JSON.stringify({
            jsonrpc: '2.0',
            id: frame.id,
            result: { session: { sessionId: 'probe-session-1' }, viewCursor: 'cursor-1' },
          })}\n`));
        }
      }
      return true;
    }),
  };
  spawned.push(child);
  return child;
}

describe('museUsageProbeInstance', () => {
  afterEach(() => {
    stopMuseUsageProbe();
    _setActiveMuseUsageProbeForTests(null);
    vi.restoreAllMocks();
  });

  it('triggers a probe exactly once (coalesced) from a muse-agent turn completion', async () => {
    const spawned = [];
    const probe = new MuseUsageProbe({
      getObserver: () => null,
      modelProviders: META_PROVIDERS,
      settings: PROBE_SETTINGS,
      spawnProcess: () => createHangingServe(spawned),
      requestTimeoutMs: 20,
      turnTimeoutMs: 30,
      killGraceMs: 5,
      killProcessGroup: createAbsentGroupDouble(),
    });
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'muse' }) });

    triggerMuseUsageProbe('session-1');
    triggerMuseUsageProbe('session-1');
    await probe.trigger();
    await tick();

    expect(spawned).toHaveLength(1);
  });

  it('coalesced triggers never reach real process signaling (Issue 17)', async () => {
    // Non-delegating spy: nothing reaches the OS. An absent group reads
    // as ESRCH so teardown falls back to the mocked direct `child.kill`.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    try {
      const spawned = [];
      const probe = new MuseUsageProbe({
        getObserver: () => null,
        modelProviders: META_PROVIDERS,
        settings: PROBE_SETTINGS,
        spawnProcess: () => createHangingServe(spawned),
        requestTimeoutMs: 20,
        turnTimeoutMs: 30,
        killGraceMs: 5,
        killProcessGroup: createAbsentGroupDouble(),
      });
      _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'muse' }) });

      triggerMuseUsageProbe('session-1');
      triggerMuseUsageProbe('session-1');
      await probe.trigger();
      await probe.stop();
      await tick();

      expect(spawned).toHaveLength(1);
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });

  it('ignores triggers for other agent types', () => {
    const probe = fakeProbe();
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'claude-code' }) });

    triggerMuseUsageProbe('session-1');

    expect(probe.trigger).not.toHaveBeenCalled();
  });

  it('ignores triggers for unknown sessions', () => {
    const probe = fakeProbe();
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo(null) });

    triggerMuseUsageProbe('missing-session');

    expect(probe.trigger).not.toHaveBeenCalled();
  });

  it('is idle without a started probe', () => {
    expect(() => triggerMuseUsageProbe('session-1', {
      sessionRepository: museSessionRepo({ agentType: 'muse' }),
    })).not.toThrow();
  });

  it('runs the heartbeat on a fixed five-minute cadence', () => {
    expect(MUSE_USAGE_PROBE_HEARTBEAT_MS).toBe(5 * 60_000);
  });

  it('heartbeat fires only while an executing muse session exists', async () => {
    const probe = fakeProbe();
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: executingRepo(true) });

    await heartbeatTick();

    expect(probe.trigger).toHaveBeenCalledTimes(1);
  });

  it('heartbeat stays idle without executing muse sessions', async () => {
    const probe = fakeProbe();
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: executingRepo(false) });

    await heartbeatTick();

    expect(probe.trigger).not.toHaveBeenCalled();
  });

  it('heartbeat stays idle without a started probe', async () => {
    await expect(heartbeatTick({ sessionRepository: executingRepo(true) })).resolves.toBeUndefined();
  });

  it('start wires the heartbeat and stop clears it', async () => {
    vi.useFakeTimers();
    try {
      const probe = fakeProbe();
      startMuseUsageProbe({
        createProbe: () => probe,
        sessionRepository: executingRepo(true),
      });

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(probe.trigger).toHaveBeenCalledTimes(1);

      stopMuseUsageProbe();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(probe.trigger).toHaveBeenCalledTimes(1);
      expect(probe.stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wires the allowance observer factory without calling it (Issue 1)', () => {
    const probe = startMuseUsageProbe();
    try {
      // The probe calls this dependency as a zero-argument factory per
      // attempt; passing the already-bound observer would make every real
      // observation resolve to null while logging `ok`.
      expect(probe.getObserver).toBe(getProviderAllowanceObserver);
    } finally {
      stopMuseUsageProbe();
    }
  });

  describe('shutdown ownership (Issue 19)', () => {
    function controllableProbe() {
      let resolveCleanup;
      const cleanup = new Promise((resolve) => { resolveCleanup = resolve; });
      return {
        resolveCleanup,
        cleanup,
        probe: {
          trigger: vi.fn().mockResolvedValue(true),
          stop: vi.fn(() => cleanup),
          forceKillOwnedGroup: vi.fn(),
        },
      };
    }

    function activateControllable() {
      const controlled = controllableProbe();
      _setActiveMuseUsageProbeForTests(controlled.probe, {
        sessionRepository: museSessionRepo({ agentType: 'muse' }),
      });
      return controlled;
    }

    it('stop returns cleanup that gates shutdown while disabling triggers immediately', async () => {
      const { probe, resolveCleanup } = activateControllable();
      try {
        const cleanup = stopMuseUsageProbe();
        expect(probe.stop).toHaveBeenCalledTimes(1);

        // Scheduling and triggers are disabled synchronously, before cleanup.
        triggerMuseUsageProbe('session-1');
        expect(probe.trigger).not.toHaveBeenCalled();
        await heartbeatTick();
        expect(probe.trigger).not.toHaveBeenCalled();

        let settled = false;
        void Promise.resolve(cleanup).then(() => { settled = true; });
        await tick();
        expect(settled).toBe(false);
        resolveCleanup();
        await Promise.resolve(cleanup);
        expect(settled).toBe(true);
      } finally {
        // Never strand a draining entry: a failure here must not hang
        // later tests behind this probe's unsettled cleanup.
        resolveCleanup();
        await tick();
      }
    });

    it('repeated stop shares one cleanup without duplicate teardown', async () => {
      const { probe, resolveCleanup } = activateControllable();
      try {
        const first = stopMuseUsageProbe();
        let firstSettled = false;
        void Promise.resolve(first).then(() => { firstSettled = true; });
        const second = stopMuseUsageProbe();
        let secondSettled = false;
        void Promise.resolve(second).then(() => { secondSettled = true; });
        await tick();
        // Neither cleanup may settle before the probe's teardown does, and
        // the second stop must not lose (or duplicate) the first cleanup.
        expect(firstSettled).toBe(false);
        expect(secondSettled).toBe(false);
        resolveCleanup();
        await Promise.resolve(first);
        await Promise.resolve(second);
        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
        expect(probe.stop).toHaveBeenCalledTimes(1);
      } finally {
        resolveCleanup();
        await tick();
      }
    });

    it('force-stop SIGKILLs the active probe group synchronously', async () => {
      const { probe, resolveCleanup } = activateControllable();
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      });
      try {
        forceStopMuseUsageProbe();
        expect(probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
        expect(killSpy).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
      // Drain the probe this test activated so afterEach cannot strand
      // its cleanup behind the lost resolver and hang later tests.
      stopMuseUsageProbe();
      resolveCleanup();
      await stopMuseUsageProbe();
    });

    it('force-stop reaches a draining probe after stop cleared the singleton', async () => {
      const { probe, resolveCleanup } = activateControllable();
      stopMuseUsageProbe();
      forceStopMuseUsageProbe();
      expect(probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
      // A second force is idempotent best-effort, never a throw.
      expect(() => forceStopMuseUsageProbe()).not.toThrow();
      resolveCleanup();
      await stopMuseUsageProbe();
    });

    it('retains a restart-displaced probe for force cleanup until teardown settles', async () => {
      const first = controllableProbe();
      _setActiveMuseUsageProbeForTests(first.probe, {
        sessionRepository: museSessionRepo({ agentType: 'muse' }),
      });
      const second = controllableProbe();
      startMuseUsageProbe({
        createProbe: () => second.probe,
        sessionRepository: museSessionRepo({ agentType: 'muse' }),
      });
      try {
        expect(first.probe.stop).toHaveBeenCalledTimes(1);
        forceStopMuseUsageProbe();
        expect(first.probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
        expect(second.probe.forceKillOwnedGroup).toHaveBeenCalledTimes(1);
        first.resolveCleanup();
        second.resolveCleanup();
        await tick();
      } finally {
        stopMuseUsageProbe();
        first.resolveCleanup();
        second.resolveCleanup();
        await stopMuseUsageProbe();
      }
    });

    it('drops settled probes from force ownership', async () => {
      const { probe, resolveCleanup } = activateControllable();
      const cleanup = stopMuseUsageProbe();
      resolveCleanup();
      await Promise.resolve(cleanup);
      forceStopMuseUsageProbe();
      expect(probe.forceKillOwnedGroup).not.toHaveBeenCalled();
    });

    it('stop and force-stop are safe no-ops without an active probe', async () => {
      _setActiveMuseUsageProbeForTests(null);
      await expect(Promise.resolve(stopMuseUsageProbe())).resolves.toBeUndefined();
      expect(() => forceStopMuseUsageProbe()).not.toThrow();
    });

    it('forced cleanup runs every callback even when one throws', () => {
      const events = [];
      const combined = combineForcedCleanup(
        () => { events.push('command'); throw new Error('command boom'); },
        () => { events.push('muse'); throw new Error('muse boom'); },
      );
      expect(() => combined()).not.toThrow();
      expect(events).toEqual(['command', 'muse']);
    });

    it('forced cleanup still runs the command path when the muse path throws first', () => {
      const events = [];
      const combined = combineForcedCleanup(
        () => { events.push('muse'); throw new Error('muse boom'); },
        () => { events.push('command'); },
      );
      expect(() => combined()).not.toThrow();
      expect(events).toEqual(['muse', 'command']);
    });
  });

  it('never throws out of trigger or heartbeat paths', async () => {
    const probe = { trigger: () => { throw new Error('boom'); }, stop: vi.fn() };
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'muse' }) });

    expect(() => triggerMuseUsageProbe('session-1')).not.toThrow();
    await expect(heartbeatTick()).resolves.toBeUndefined();
  });
});
