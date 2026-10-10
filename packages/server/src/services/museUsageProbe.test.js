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

/** UUIDv7 shape required by the MSP schema for `commandId` (SS2.5, SS3.1.1). */
const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Fake `muse serve` enforcing the real MSP protocol shapes: it rejects
 * `session/start` and `turn/start` requests without a UUIDv7 `commandId`
 * (invalid params), answers `session/start` with the nested
 * `{session: {sessionId}, viewCursor}` result, answers `turn/start` with an
 * admission acknowledgement only, and reports turn completion as a
 * `turn/completed` notification. No real `muse` process is ever spawned.
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
  let turnCounter = 0;
  const turnIdsByRequest = new Map();

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
      const session = [...sent].reverse().find((frame) => frame.method === 'session/start');
      fake.emitFrame({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {
          sessionId: turn?.params?.sessionId ?? session?.result,
          turnId: turnIdsByRequest.get(turn?.id),
          terminal: 'completed',
          sourceRange: { start: 0, end: 1 },
          viewCursor: 'cursor-end',
        },
      });
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
          if (!UUIDV7_RE.test(frame.params?.commandId ?? '')) {
            fake.emitFrame({ jsonrpc: '2.0', id: frame.id, error: { code: -32602, message: 'missing commandId' } });
            continue;
          }
          sessionCounter += 1;
          fake.emitFrame({
            jsonrpc: '2.0',
            id: frame.id,
            result: { session: { sessionId: `probe-session-${sessionCounter}` }, viewCursor: `cursor-${sessionCounter}` },
          });
          continue;
        }
        if (frame.method === 'turn/start') {
          if (!UUIDV7_RE.test(frame.params?.commandId ?? '')) {
            fake.emitFrame({ jsonrpc: '2.0', id: frame.id, error: { code: -32602, message: 'missing commandId' } });
            continue;
          }
          turnCounter += 1;
          const turnId = `probe-turn-${turnCounter}`;
          turnIdsByRequest.set(frame.id, turnId);
          fake.emitFrame({
            jsonrpc: '2.0',
            id: frame.id,
            result: {
              commandId: frame.params.commandId,
              status: 'accepted',
              disposition: 'started',
              startedNewTurn: true,
              turnId,
            },
          });
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
  let spawnCount = 0;
  const spawnProcess = vi.fn(() => {
    if (overrides.spawnThrows) throw new Error('spawn ENOENT');
    const next = (overrides.spawnSequence ?? [])[spawnCount];
    spawnCount += 1;
    return next ?? child;
  });
  const observed = [];
  let now = 1_789_855_000_000;
  const probe = new MuseUsageProbe({
    getObserver: () => (candidate) => { observed.push(candidate); },
    modelProviders: overrides.modelProviders ?? modelProvidersFake(),
    settings: overrides.settings ?? settingsFake(overrides.probeModel),
    clock: { now: () => now },
    spawnProcess,
    requestTimeoutMs: 50,
    turnTimeoutMs: 100,
    killGraceMs: 10,
    ...(overrides.probeOptions ?? {}),
  });
  return { probe, child, spawnProcess, observed, advanceTime: (ms) => { now += ms; } };
}

describe('buildMuseProbeArgs', () => {
  it('serves memory-only with the configured model', () => {
    expect(buildMuseProbeArgs('muse-spark-1.3-contributor')).toEqual({
      command: 'muse',
      args: ['serve', '--no-session-log', '--provider', 'meta', '--model', 'muse-spark-1.3-contributor'],
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
    expect(args).toEqual(['serve', '--no-session-log', '--provider', 'meta', '--model', 'muse-spark-1.3-contributor']);
    const turn = child.fake.sent.find((frame) => frame.method === 'turn/start');
    expect(turn.params.input).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('sends session/start with a UUIDv7 commandId (Issue 2)', async () => {
    const { probe, child } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    const start = child.fake.sent.find((frame) => frame.method === 'session/start');
    expect(start.params?.commandId).toMatch(UUIDV7_RE);
    const turn = child.fake.sent.find((frame) => frame.method === 'turn/start');
    expect(turn.params?.sessionId).toBe('probe-session-1');
  });

  it('sends turn/start with a UUIDv7 commandId (Issue 3)', async () => {
    const { probe, child } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    const turn = child.fake.sent.find((frame) => frame.method === 'turn/start');
    expect(turn.params?.commandId).toMatch(UUIDV7_RE);
    expect(turn.params?.sessionId).toBe('probe-session-1');
    expect(turn.params?.input).toEqual([{ type: 'text', text: 'Hi' }]);
  });

  it('waits for turn completion instead of ending on admission (Issue 4)', async () => {
    const { probe, child, observed } = makeProbe();
    const promise = probe.trigger();
    await settle();

    // The admission acknowledgement has arrived; the probe must not read
    // usage or finish until the turn actually completes.
    expect(child.fake.sent.some((frame) => frame.method === 'usage/read')).toBe(false);
    expect(observed).toHaveLength(0);

    child.fake.endTurn();
    await promise;

    expect(child.fake.sent.some((frame) => frame.method === 'usage/read')).toBe(true);
    expect(observed).toHaveLength(1);
  });

  it('pins probe routing to the Meta provider (Issue 6)', async () => {
    const { probe, child } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    const [[, args]] = probe.lastSpawn;
    expect(args[args.indexOf('--provider') + 1]).toBe('meta');
    const start = child.fake.sent.find((frame) => frame.method === 'session/start');
    expect(start.params?.providerId).toBe('meta');
  });

  it('spaces consecutive failures with bounded backoff (Issue 7)', async () => {
    const { probe, spawnProcess, advanceTime } = makeProbe({ spawnThrows: true });
    await probe.trigger();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    // A rapid retry is suppressed without spawning and without tripping
    // the permanent breaker.
    await probe.trigger();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(probe.state).not.toBe('disabled');
    // After the cooldown a retry is accepted again.
    advanceTime(2_000);
    await probe.trigger();
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('holds the single-flight guard through teardown (Issue 8)', async () => {
    const { probe, child, spawnProcess, observed } = makeProbe();
    const first = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await settle();
    // Teardown is still draining the process: a new trigger must join the
    // in-flight probe, not spawn a second process alongside the old one.
    expect(probe.process).toBe(child);
    const second = probe.trigger();
    await Promise.all([first, second]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(observed).toHaveLength(1);
  });

  it('ignores late callbacks from a superseded generation (Issue 8)', async () => {
    const oldChild = createFakeServe();
    const newChild = createFakeServe();
    const { probe, spawnProcess, observed, advanceTime } = makeProbe({ spawnSequence: [oldChild, newChild] });
    const first = probe.trigger();
    await settle();
    await probe.stop();
    await first;
    advanceTime(2_000);
    const second = probe.trigger();
    await settle();
    // Late callbacks from the previous generation must not abort the new probe.
    oldChild.emit('error', new Error('late hangup'));
    newChild.fake.pushUsageChanged();
    await settle();
    newChild.fake.endTurn();
    await second;
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(observed).toHaveLength(1);
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

  it('aborts safely on async stdin EPIPE without crashing (Issue 5)', async () => {
    const child = createFakeServe();
    const { probe, observed } = makeProbe({ child });
    // A real socket surfaces mid-write pipe failures as an async `error`
    // event, outside any synchronous try/catch around `write`.
    child.stdin = Object.assign(new EventEmitter(), { write: child.stdin.write });
    const promise = probe.trigger();
    await settle();
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await expect(promise).resolves.toBe(false);
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
    const { probe, spawnProcess, advanceTime } = makeProbe({ spawnThrows: true });
    for (let i = 0; i < 5; i += 1) {
      await probe.trigger();
      advanceTime(60_000);
    }
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
    const { probe, advanceTime } = makeProbe({ child, probeOptions: { spawnProcess } });
    await probe.trigger();
    advanceTime(60_000);
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
