import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuseUsageProbe } from './museUsageProbe.js';
import { getProviderAllowanceObserver } from './providerAllowanceServiceInstance.js';
import {
  MUSE_USAGE_PROBE_HEARTBEAT_MS,
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
    });
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'muse' }) });

    triggerMuseUsageProbe('session-1');
    triggerMuseUsageProbe('session-1');
    await probe.trigger();
    await tick();

    expect(spawned).toHaveLength(1);
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

  it('never throws out of trigger or heartbeat paths', async () => {
    const probe = { trigger: () => { throw new Error('boom'); }, stop: vi.fn() };
    _setActiveMuseUsageProbeForTests(probe, { sessionRepository: museSessionRepo({ agentType: 'muse' }) });

    expect(() => triggerMuseUsageProbe('session-1')).not.toThrow();
    await expect(heartbeatTick()).resolves.toBeUndefined();
  });
});
