import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRobustEnv } from './nodeSpawnHelper.js';
import {
  LAST_SPAWN_HISTORY,
  MuseUsageProbe,
  buildMuseProbeArgs,
  resolveMuseAllowanceProvider,
  resolveMuseProbeModel,
} from './museUsageProbe.js';
import {
  MUSE_CLIENT_NAME_PATTERN,
  MUSE_PROBE_CLIENT_INFO,
} from './museUsageProbeSupport.js';

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
          answerInitializeFrame(fake, frame, answerInitialize);
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

/**
 * Answer one `initialize` frame like the real host (SS1.4.1):
 * `clientInfo.name` must be a machine identifier matching `^[a-z0-9_]+$`;
 * anything else is rejected with `-32602 invalidParams`.
 */
function answerInitializeFrame(fake, frame, answerInitialize) {
  if (!MUSE_CLIENT_NAME_PATTERN.test(frame.params?.clientInfo?.name ?? '')) {
    fake.emitFrame({ jsonrpc: '2.0', id: frame.id, error: { code: -32602, message: 'clientInfo.name must be a machine identifier matching ^[a-z0-9_]+$ (SS1.4.1)' } });
    return;
  }
  if (answerInitialize) {
    fake.emitFrame({ jsonrpc: '2.0', id: frame.id, result: { capabilities: ['session'] } });
  }
}

/**
 * Absent-group signal double (Issue 17): emitter-only fake children own no
 * real OS process group, so every group signal throws ESRCH and teardown
 * falls back to the mocked direct `child.kill`. Signal-0 liveness therefore
 * reads the fake group as already reaped — no fake-spawn test can signal
 * (or probe the liveness of) an unrelated real process group.
 */
function createAbsentGroupDouble() {
  const killProcessGroup = vi.fn(() => {
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  });
  return { killProcessGroup };
}

/**
 * Present-group signal double (Issue 17): models termination transitions
 * for cases that test group escalation. The fake group stays alive while
 * its members ignore SIGTERM and is gone once it takes SIGKILL; signal `0`
 * probes liveness without delivering a signal.
 */
function createPresentGroupDouble() {
  const signals = [];
  let alive = true;
  const killProcessGroup = vi.fn((pid, signal) => {
    signals.push([pid, signal]);
    if (signal === 0) {
      if (!alive) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      return;
    }
    if (signal === 'SIGKILL') alive = false;
  });
  return { signals, killProcessGroup };
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
    // Safety default applied after overrides: fake children own no real OS
    // group, so an override can only replace this double with another
    // double — never silently restore real `process.kill` for fake spawns.
    killProcessGroup: overrides.probeOptions?.killProcessGroup
      ?? createAbsentGroupDouble().killProcessGroup,
  });
  return { probe, child, spawnProcess, observed, advanceTime: (ms) => { now += ms; } };
}

describe('MUSE_PROBE_CLIENT_INFO (Issue 10)', () => {
  it('uses a host-conforming machine identifier', () => {
    expect(MUSE_PROBE_CLIENT_INFO.name).toMatch(MUSE_CLIENT_NAME_PATTERN);
    expect(MUSE_PROBE_CLIENT_INFO.version).toBeTruthy();
  });

  it('fake rejects initialize with a non-conforming name (-32602)', async () => {
    const child = createFakeServe();
    const frames = [];
    child.stdout.on('data', (chunk) => { frames.push(String(chunk)); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'initialize', params: { clientInfo: { name: 'has-hyphen', version: '1.0.0' } } })}\n`);
    await settle();
    const blob = frames.join('\n');
    expect(blob).toContain('-32602');
  });
});

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

  it('caps lastSpawn history to the most recent spawns (Issue 13)', async () => {
    const children = [createFakeServe(), createFakeServe(), createFakeServe(), createFakeServe(), createFakeServe()];
    const { probe } = makeProbe({ spawnSequence: children });
    const previousBin = process.env.MUSE_BIN;
    try {
      for (let i = 0; i < children.length; i += 1) {
        process.env.MUSE_BIN = `muse-probe-${i}`;
        const promise = probe.trigger();
        await settle();
        children[i].fake.pushUsageChanged();
        await settle();
        children[i].fake.endTurn();
        await promise;
      }
    } finally {
      if (previousBin === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = previousBin;
    }
    // Five serialized probes retain only the three most recent spawns,
    // oldest → newest.
    expect(probe.lastSpawn).toHaveLength(LAST_SPAWN_HISTORY);
    expect(probe.lastSpawn.map(([command]) => command)).toEqual([
      'muse-probe-2',
      'muse-probe-3',
      'muse-probe-4',
    ]);
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

  it('times out the read phase only after reaching usage/read (Issue 16)', async () => {
    const child = createFakeServe();
    const { probe, observed } = makeProbe({
      child,
      probeOptions: { requestTimeoutMs: 20, turnTimeoutMs: 5_000 },
    });
    const originalWrite = child.stdin.write;
    let readAttempted = false;
    child.stdin.write = vi.fn((chunk) => {
      if (String(chunk).includes('usage/read')) {
        readAttempted = true;
        return true;
      }
      return originalWrite(chunk);
    });
    const promise = probe.trigger();
    for (let i = 0; i < 200 && !child.fake.sent.some((frame) => frame.method === 'turn/start'); i += 1) {
      await tick();
    }
    expect(child.fake.sent.some((frame) => frame.method === 'turn/start')).toBe(true);
    child.fake.endTurn();
    await promise;

    // The turn deadline (5s) cannot have fired: this no-data result is the
    // read request timing out after the quiet turn completed.
    expect(readAttempted).toBe(true);
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
    // Direct-child fallback path (Issue 17): no fake PID, so teardown
    // exercises the mocked `child.kill` instead of any process group.
    delete child.pid;
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

  it('escalates the owned fake group to SIGKILL when it ignores SIGTERM (Issue 17)', async () => {
    const { signals, killProcessGroup } = createPresentGroupDouble();
    const { probe, child } = makeProbe({ probeOptions: { killProcessGroup } });
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    const delivered = signals.filter(([, signal]) => signal !== 0).map(([, signal]) => signal);
    expect(delivered[0]).toBe('SIGTERM');
    expect(delivered).toContain('SIGKILL');
    expect(signals.every(([pid]) => pid === -child.pid)).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('spawns with a normalized host env in sparse-PATH launches (Issue 14)', async () => {
    const shellEnv = { PATH: `/opt/muse/bin:${process.env.PATH ?? ''}` };
    const parentPath = process.env.PATH;
    const { probe, child, spawnProcess } = makeProbe({ probeOptions: { shellEnv } });
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const spawnOptions = spawnProcess.mock.calls[0][2];
    expect(spawnOptions?.env).toBeDefined();
    expect(String(spawnOptions.env.PATH).split(path.delimiter)).toContain('/opt/muse/bin');
    expect(spawnOptions.env.HOME).toBeTruthy();
    // The spawn seam receives the shared normalization path, not a copy.
    expect(spawnOptions.env).toEqual(createRobustEnv(process.env, { shellEnv }));
    // Building the probe environment never mutates the parent environment.
    expect(process.env.PATH).toBe(parentPath);
    expect(probe.lastSpawn).toHaveLength(1);
  });

  it('spawns the probe in its own process group on POSIX (Issue 15)', async () => {
    const { probe, child, spawnProcess } = makeProbe();
    const promise = probe.trigger();
    await settle();
    child.fake.pushUsageChanged();
    await settle();
    child.fake.endTurn();
    await promise;

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess.mock.calls[0][2]).toMatchObject({
      detached: process.platform !== 'win32',
    });
  });

  describe('fake-process signal isolation (Issue 17)', () => {
    function interceptRealSignals() {
      // Non-delegating spy: nothing reaches the OS. An absent group reads
      // as ESRCH so teardown falls back to the mocked direct `child.kill`.
      return vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      });
    }

    it('never reaches real process signaling on normal completion', async () => {
      const killSpy = interceptRealSignals();
      try {
        const { probe, child } = makeProbe();
        const promise = probe.trigger();
        await settle();
        child.fake.pushUsageChanged();
        await settle();
        child.fake.endTurn();
        await promise;
        await probe.stop();
        expect(killSpy).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
    });

    it('never reaches real process signaling on timeout cleanup', async () => {
      const killSpy = interceptRealSignals();
      try {
        const child = createFakeServe({ answerInitialize: false });
        const { probe } = makeProbe({
          child,
          probeOptions: { requestTimeoutMs: 20, turnTimeoutMs: 30 },
        });
        await probe.trigger();
        await probe.stop();
        expect(killSpy).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
    });

    it('never reaches real process signaling on stop cleanup', async () => {
      const killSpy = interceptRealSignals();
      try {
        const { probe } = makeProbe();
        const promise = probe.trigger();
        await settle();
        await probe.stop();
        await promise;
        expect(killSpy).not.toHaveBeenCalled();
      } finally {
        killSpy.mockRestore();
      }
    });
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
