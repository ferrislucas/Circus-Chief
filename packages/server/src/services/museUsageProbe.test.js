import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MuseUsageProbe,
  buildMuseProbeArgs,
  resolveMuseAllowanceProvider,
  resolveMuseProbeModel,
} from './museUsageProbe.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(times = 5) {
  for (let i = 0; i < times; i += 1) await tick();
}

const USAGE_PAYLOAD = {
  observedAtMs: 1_789_855_000_000,
  window: { resetsAtMs: 1_789_860_000_000, usedPercent: 17, windowDurationMins: 300 },
  weekly: { resetsAtMs: 1_789_940_000_000, usedPercent: 83 },
};

const META_PROVIDER = { id: 'meta-default', name: 'Meta (Official)', kind: 'meta', isBuiltIn: true, enabled: true };

const META_MODELS = [
  { modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', enabled: true },
  { modelId: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', enabled: true },
];

function modelProvidersFake({ providers = [META_PROVIDER], models = META_MODELS } = {}) {
  return {
    getEnabledForAllowances: () => providers,
    getById: (id) => {
      const provider = providers.find((p) => p.id === id) ?? null;
      if (!provider || models === null) return provider;
      return { ...provider, models };
    },
  };
}

const settingsFake = (probeModel = 'muse-spark-1.3') => ({
  getMuseProbeSettings: () => ({ probeModel }),
});

/**
 * Fake `muse serve` speaking the probe's JSON-RPC shape: it answers
 * `initialize`, `session/start`, and `usage/read` with canned results,
 * records every frame it is sent, and lets the test push `usage/changed`
 * mid-turn. No real `muse` process is ever spawned.
 */
function createFakeServe({ usage = USAGE_PAYLOAD, answerInitialize = true } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
    pid: 4242,
  });
  const sent = [];
  let sessionCounter = 0;

  const fake = {
    sent,
    requests() {
      return sent.filter((frame) => frame.id !== undefined);
    },
    emitFrame(frame) {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
    },
    pushUsageChanged(payload = usage) {
      fake.emitFrame({ jsonrpc: '2.0', method: 'usage/changed', params: payload });
    },
    endTurn() {
      const turn = [...sent].reverse().find((frame) => frame.method === 'turn/start');
      fake.emitFrame({ jsonrpc: '2.0', id: turn.id, result: { status: 'completed' } });
    },
  };

  child.stdin = {
    write: vi.fn((chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        sent.push(frame);
        if (frame.method === 'initialize') {
          if (answerInitialize) {
            fake.emitFrame({ jsonrpc: '2.0', id: frame.id, result: { capabilities: ['session'] } });
          }
          continue;
        }
        if (frame.method === 'session/start') {
          sessionCounter += 1;
          fake.emitFrame({ jsonrpc: '2.0', id: frame.id, result: { sessionId: `probe-session-${sessionCounter}` } });
          continue;
        }
        if (frame.method === 'usage/read') {
          fake.emitFrame({ jsonrpc: '2.0', id: frame.id, result: { usage } });
        }
      }
      return true;
    }),
  };
  child.fake = fake;
  return child;
}

function makeProbe(overrides = {}) {
  const child = overrides.child ?? createFakeServe(overrides.fakeOptions);
  const spawnProcess = vi.fn(() => {
    if (overrides.spawnThrows) throw new Error('spawn ENOENT');
    return child;
  });
  const observed = [];
  const probe = new MuseUsageProbe({
    getObserver: () => (candidate) => { observed.push(candidate); },
    modelProviders: overrides.modelProviders ?? modelProvidersFake(),
    settings: overrides.settings ?? settingsFake(overrides.probeModel),
    clock: { now: () => 1_789_855_000_000 },
    spawnProcess,
    requestTimeoutMs: 50,
    turnTimeoutMs: 100,
    killGraceMs: 10,
    ...(overrides.probeOptions ?? {}),
  });
  return { probe, child, spawnProcess, observed };
}

describe('buildMuseProbeArgs', () => {
  it('serves memory-only with the configured model', () => {
    expect(buildMuseProbeArgs('muse-spark-1.3-contributor')).toEqual({
      command: 'muse',
      args: ['serve', '--no-session-log', '--model', 'muse-spark-1.3-contributor'],
    });
  });

  it('honors MUSE_BIN', () => {
    const previous = process.env.MUSE_BIN;
    process.env.MUSE_BIN = '/opt/muse/bin/muse';
    try {
      expect(buildMuseProbeArgs('muse-spark-1.3').command).toBe('/opt/muse/bin/muse');
    } finally {
      if (previous === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = previous;
    }
  });
});

describe('resolveMuseAllowanceProvider', () => {
  it('selects the built-in meta provider', () => {
    const providers = modelProvidersFake();
    expect(resolveMuseAllowanceProvider(providers)).toMatchObject({ id: 'meta-default' });
  });

  it('stands down when the meta provider is disabled or removed', () => {
    expect(resolveMuseAllowanceProvider(modelProvidersFake({ providers: [] }))).toBeNull();
    const disabled = [{ ...META_PROVIDER, enabled: false }];
    expect(resolveMuseAllowanceProvider({ getEnabledForAllowances: () => disabled })).toBeNull();
    expect(resolveMuseAllowanceProvider(null)).toBeNull();
  });
});

describe('resolveMuseProbeModel', () => {
  const models = [
    { modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', enabled: true },
    { modelId: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', enabled: true },
  ];

  it('returns the stored model when it names an enabled meta model', () => {
    expect(resolveMuseProbeModel({
      settings: settingsFake('muse-spark-1.3-contributor'),
      modelProviders: modelProvidersFake({ models }),
    })).toBe('muse-spark-1.3-contributor');
  });

  it.each([
    ['unset', settingsFake('')],
    ['unknown', settingsFake('muse-spark-9.9')],
    ['disabled', settingsFake('muse-spark-1.3-contributor')],
  ])('resolves %s values to the default', (_label, settings) => {
    const providers = _label === 'disabled'
      ? modelProvidersFake({ models: models.map((m) => (m.modelId === 'muse-spark-1.3-contributor' ? { ...m, enabled: false } : m)) })
      : modelProvidersFake({ models });
    expect(resolveMuseProbeModel({ settings, modelProviders: providers })).toBe('muse-spark-1.3');
  });

  it('resolves to the default without a meta provider', () => {
    expect(resolveMuseProbeModel({
      settings: settingsFake('muse-spark-1.3-contributor'),
      modelProviders: modelProvidersFake({ providers: [] }),
    })).toBe('muse-spark-1.3');
  });
});

describe('MuseUsageProbe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the happy path on a mid-turn usage/changed frame', async () => {
    const { probe, child, spawnProcess, observed } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      providerId: 'meta-default',
      providerKind: 'meta',
      source: 'provider',
    });
    expect(observed[0].allowances).toHaveLength(2);
    expect(observed[0].allowances[0]).toMatchObject({ key: 'window', remainingPercent: 83 });
  });

  it('passes the configured model and Hi prompt on the wire', async () => {
    const { probe, child } = makeProbe({ probeModel: 'muse-spark-1.3-contributor' });
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    const [[command, args]] = probe.lastSpawn;
    expect(command).toBe('muse');
    expect(args).toEqual(['serve', '--no-session-log', '--model', 'muse-spark-1.3-contributor']);
    const turn = child.fake.sent.find((frame) => frame.method === 'turn/start');
    expect(turn.params.input).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('falls back to usage/read when the turn stays quiet', async () => {
    const { probe, child, observed } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.endTurn();
    await promise;

    expect(child.fake.sent.some((frame) => frame.method === 'usage/read')).toBe(true);
    expect(observed).toHaveLength(1);
    expect(observed[0].allowances[0]).toMatchObject({ key: 'window', remainingPercent: 83 });
  });

  it.each([
    ['handshake', { answerInitialize: false }],
    ['start', { hangStart: true }],
    ['turn', { hangTurn: true }],
    ['read', { hangRead: true, quietTurn: true }],
  ])('resolves no-data on %s timeout without observing', async (_phase, options) => {
    const child = createFakeServe({ answerInitialize: options.answerInitialize ?? true });
    const { probe, observed } = makeProbe({ child, probeOptions: { requestTimeoutMs: 20, turnTimeoutMs: 30 } });
    if (options.hangStart || options.hangTurn || options.hangRead) {
      const originalWrite = child.stdin.write;
      child.stdin.write = vi.fn((chunk) => {
        const text = String(chunk);
        if ((options.hangStart && text.includes('session/start'))
          || (options.hangTurn && text.includes('turn/start'))
          || (options.hangRead && text.includes('usage/read'))) return true;
        return originalWrite(chunk);
      });
    }
    await probe.trigger();
    expect(observed).toHaveLength(0);
  });

  it('resolves no-data on non-zero exit', async () => {
    const { probe, child, observed } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.emit('exit', 1);
    await promise;
    expect(observed).toHaveLength(0);
  });

  it('resolves no-data on unparseable frames', async () => {
    const { probe, child, observed } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.stdout.emit('data', Buffer.from('this is not json {{{\n'));
    await settle();
    child.emit('exit', 0);
    await promise;
    expect(observed).toHaveLength(0);
  });

  it('resolves no-data when spawn fails', async () => {
    const { probe, observed } = makeProbe({ spawnThrows: true });
    await probe.trigger();
    expect(observed).toHaveLength(0);
  });

  it('suppresses a second trigger while a probe is in flight', async () => {
    const { probe, child, spawnProcess, observed } = makeProbe();
    const first = probe.trigger();
    const second = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await Promise.all([first, second]);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(observed).toHaveLength(1);
  });

  it('trips the breaker after repeated failures', async () => {
    const { probe, spawnProcess } = makeProbe({ spawnThrows: true });
    for (let i = 0; i < 5; i += 1) await probe.trigger();
    await probe.trigger();
    expect(spawnProcess).toHaveBeenCalledTimes(5);
  });

  it('recovers the failure streak after a success', async () => {
    let failures = 1;
    const child = createFakeServe();
    const spawnProcess = vi.fn(() => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('spawn ENOENT');
      }
      return child;
    });
    const { probe } = makeProbe({ child, probeOptions: { spawnProcess } });
    await probe.trigger();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;
    expect(probe.consecutiveFailures).toBe(0);
  });

  it('stands down without spawning when no meta provider is eligible', async () => {
    const { probe, spawnProcess, observed } = makeProbe({
      modelProviders: modelProvidersFake({ providers: [] }),
    });
    await probe.trigger();
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(observed).toHaveLength(0);
  });

  it('escalates SIGTERM to SIGKILL when the child hangs on teardown', async () => {
    const { probe, child } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;
    await new Promise((resolve) => setTimeout(resolve, 40));

    const signals = child.kill.mock.calls.map((call) => call[0]);
    expect(signals[0]).toBe('SIGTERM');
    expect(signals).toContain('SIGKILL');
  });

  it('never logs raw frames, prompts, or tier material', async () => {
    const logged = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { logged.push(args.join(' ')); });
    try {
      const { probe, child } = makeProbe();
      const promise = probe.trigger();
      await settle();
      child.fake.pushUsageChanged({ ...USAGE_PAYLOAD, tier: 'secret-tier-marker' });
      await settle();
      child.fake.endTurn();
      await promise;
    } finally {
      spy.mockRestore();
    }
    const blob = logged.join('\n');
    expect(blob).not.toContain('secret-tier-marker');
    expect(blob).not.toContain('usedPercent');
  });
});
