import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexAppServerMeter,
  _setActiveCodexAppServerMeterForTests,
  isCodexAppServerMeterHealthy,
  parseCodexMinorVersion,
  startCodexAppServerMeter,
  stopCodexAppServerMeter,
} from './codexAppServerMeter.js';
import { getStreamStaleAfterMs } from '../config/providerAllowances.js';

// Sanitized from a real `codex app-server` account/rateLimits/read result
// (codex-cli 0.145.0): camelCase window fields, seconds-precision resetsAt,
// and extra account metadata the mapper must ignore.
const RATE_LIMIT_SNAPSHOT = {
  limitId: 'codex',
  limitName: null,
  primary: { usedPercent: 17, windowDurationMins: 300, resetsAt: 1_789_856_117 },
  secondary: { usedPercent: 83, windowDurationMins: 10080, resetsAt: 1_789_959_005 },
  planType: 'plus',
};

const INITIALIZE_RESULT = {
  userAgent: 'circuschief-allowance-meter/1.0.0',
  codexHome: '/tmp/codex-home',
  platformFamily: 'unix',
  platformOs: 'test',
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Fake `codex app-server` speaking the real protocol shape: it rejects any
 * request that arrives before the initialize handshake (the real binary in
 * codex-cli 0.145.0 silently drops them — rejection is the observable
 * contract the meter must not violate), records every frame it is sent, and
 * answers `initialize` with a sanitized initialization result.
 */
function createFakeAppServer({ answerInitialize = true, rejectInitialize = false } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
  });
  const sent = [];
  let initialized = false;

  const fake = {
    sent,
    emit: (frame) => child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`)),
    respondToLastRead: (result) => {
      const request = [...sent].reverse().find((frame) => frame.id !== undefined);
      fake.emit({ jsonrpc: '2.0', id: request.id, result });
    },
    respondErrorToLastRead: () => {
      const request = [...sent].reverse().find((frame) => frame.id !== undefined);
      fake.emit({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'rate limits unavailable' } });
    },
  };

  child.stdin = {
    write: vi.fn((chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line) continue;
        const frame = JSON.parse(line);
        sent.push(frame);
        if (frame.method === 'initialize') {
          if (rejectInitialize) {
            fake.emit({ jsonrpc: '2.0', id: frame.id, error: { code: -32600, message: 'initialize rejected' } });
            return true;
          }
          if (!answerInitialize) return true;
          initialized = true;
          fake.emit({ jsonrpc: '2.0', id: frame.id, result: INITIALIZE_RESULT });
          continue;
        }
        if (frame.id !== undefined && !initialized) {
          fake.emit({ jsonrpc: '2.0', id: frame.id, error: { code: -32600, message: 'request before initialization' } });
        }
      }
      return true;
    }),
  };
  child.fake = fake;
  return child;
}

function makeMeter(overrides = {}) {
  const child = createFakeAppServer(overrides.fakeOptions);
  const spawnProcess = vi.fn(() => child);
  const execFileAsync = vi.fn((_cmd, _args, _opts, cb) => cb(null, 'codex-cli 0.145.0'));
  const meter = new CodexAppServerMeter({
    getObserver: () => overrides.observer ?? null,
    modelProviders: overrides.modelProviders ?? {
      getEnabledForAllowances: () => [{ id: 'openai-chatgpt', kind: 'openai', authToken: null, additionalEnvVars: null }],
    },
    clock: { now: () => 1_789_855_000_000 },
    spawnProcess,
    execFileAsync,
    ...(overrides.meterOptions ?? {}),
  });
  return { meter, child, spawnProcess, execFileAsync };
}

async function respondToLastRead(child, result) {
  // Flush the handshake continuation (initialize response → initialized
  // notification → first read) so the read request is on the wire.
  await tick();
  child.fake.respondToLastRead(result);
  // Allow the read continuation (promise resolution → observer) to run.
  await tick();
}

describe('parseCodexMinorVersion', () => {
  it.each([
    ['codex-cli 0.145.0', 145],
    ['codex-cli 0.260.1 (abc)', 260],
    ['codex 1.0.0', 1000],
    ['garbage', -1],
  ])('parses %s to a comparable minor version', (output, expected) => {
    expect(parseCodexMinorVersion(output)).toBe(expected);
  });
});

describe('CodexAppServerMeter', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      PROVIDER_ALLOWANCES_ENABLED: process.env.PROVIDER_ALLOWANCES_ENABLED,
      PROVIDER_ALLOWANCES_CODEX_APPSERVER: process.env.PROVIDER_ALLOWANCES_CODEX_APPSERVER,
    };
    process.env.PROVIDER_ALLOWANCES_ENABLED = '1';
    process.env.PROVIDER_ALLOWANCES_CODEX_APPSERVER = '1';
  });

  afterEach(async () => {
    await stopCodexAppServerMeter();
    Object.assign(process.env, {
      PROVIDER_ALLOWANCES_ENABLED: originalEnv.PROVIDER_ALLOWANCES_ENABLED,
      PROVIDER_ALLOWANCES_CODEX_APPSERVER: originalEnv.PROVIDER_ALLOWANCES_CODEX_APPSERVER,
    });
  });

  it('reads account rate limits on start and observes every eligible ChatGPT-plan provider', async () => {
    const observer = vi.fn();
    const modelProviders = {
      getEnabledForAllowances: () => [
        { id: 'openai-chatgpt', kind: 'openai', authToken: null, additionalEnvVars: null },
        { id: 'openai-apikey', kind: 'openai', authToken: null, additionalEnvVars: { OPENAI_API_KEY: 'sk' } },
        { id: 'openai-token', kind: 'openai', authToken: 'stored', additionalEnvVars: null },
        { id: 'anthropic-x', kind: 'anthropic', authToken: null, additionalEnvVars: null },
      ],
    };
    const { meter, child } = makeMeter({ observer, modelProviders });

    await meter.start();
    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0][0].providerId).toBe('openai-chatgpt');
    expect(observer.mock.calls[0][0].allowances.map((row) => row.key)).toEqual(['five_hour', 'weekly']);
  });

  it('performs the initialize handshake before reading account rate limits', async () => {
    const observer = vi.fn();
    const { meter, child } = makeMeter({ observer });

    await meter.start();
    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });

    // Exact protocol order: initialize request → initialization response
    // (answered by the fake) → initialized notification → the read.
    expect(child.fake.sent.map((frame) => frame.method)).toEqual([
      'initialize',
      'initialized',
      'account/rateLimits/read',
    ]);
    expect(child.fake.sent[0].params.clientInfo).toEqual(expect.objectContaining({ name: expect.any(String) }));

    // A valid rate-limit result becomes the provider snapshot — mapped from
    // the real app-server wire shape (camelCase windows, AC 14 conversion).
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0][0].providerId).toBe('openai-chatgpt');
    expect(observer.mock.calls[0][0].allowances.map((row) => row.remainingPercent)).toEqual([83, 17]);
  });

  it('treats an initialization timeout as a process failure and never issues a read', async () => {
    vi.useFakeTimers();
    try {
      const { meter, child, spawnProcess } = makeMeter({
        observer: vi.fn(),
        fakeOptions: { answerInitialize: false },
        meterOptions: { requestTimeoutMs: 10 },
      });

      await meter.start();
      expect(child.fake.sent.map((frame) => frame.method)).toEqual(['initialize']);

      await vi.advanceTimersByTimeAsync(11);

      expect(meter.pendingReads.size).toBe(0);
      expect(meter.consecutiveFailures).toBe(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(meter.state).toBe('starting');
      expect(child.fake.sent).toHaveLength(1); // no read was issued
      await vi.advanceTimersByTimeAsync(1_000);
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an initialization JSON-RPC error as a process failure and never issues a read', async () => {
    vi.useFakeTimers();
    try {
      const { meter, child } = makeMeter({ observer: vi.fn(), fakeOptions: { rejectInitialize: true } });

      await meter.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(meter.pendingReads.size).toBe(0);
      expect(meter.consecutiveFailures).toBe(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(meter.state).toBe('starting');
      expect(child.fake.sent.map((frame) => frame.method)).toEqual(['initialize']); // never read
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an account/rateLimits/read JSON-RPC error as a failure, not a null success', async () => {
    vi.useFakeTimers();
    try {
      const observer = vi.fn();
      const { meter, child, spawnProcess } = makeMeter({ observer, meterOptions: { requestTimeoutMs: 10 } });

      await meter.start();
      await child.fake.respondErrorToLastRead();
      await vi.advanceTimersByTimeAsync(0);

      expect(observer).not.toHaveBeenCalled();
      expect(meter.lastDeliveredAt).toBeNull();
      expect(meter.pendingReads.size).toBe(0);
      expect(meter.consecutiveFailures).toBe(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(meter.state).toBe('starting');
      expect(spawnProcess).toHaveBeenCalledTimes(1); // restart scheduled, not fired
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads when an account/rateLimits/updated notification arrives', async () => {
    const observer = vi.fn();
    const { meter, child } = makeMeter({ observer });
    await meter.start();
    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });

    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'account/rateLimits/updated', params: {} })}\n`));
    await respondToLastRead(child, { rateLimits: { primary: { used_percent: 40, resets_at: 1_789_959_005 } } });

    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls[1][0].allowances).toEqual([
      expect.objectContaining({ key: 'five_hour', remainingPercent: 60 }),
    ]);
  });

  it('swallows observer errors and keeps mapping subsequent snapshots', async () => {
    const observer = vi.fn(() => { throw new Error('observer down'); });
    const { meter, child } = makeMeter({ observer });
    await meter.start();
    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'account/rateLimits/updated' })}\n`));
    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });

    expect(observer).toHaveBeenCalledTimes(2);
    expect(meter.healthy).toBe(true);
  });

  it('restores with backoff after a process crash and disables itself after repeated failures', async () => {
    vi.useFakeTimers();
    try {
      const { meter, spawnProcess } = makeMeter({});
      await meter.start();
      expect(spawnProcess).toHaveBeenCalledTimes(1);

      meter.onProcessFailure();
      expect(meter.state).toBe('starting');
      await vi.advanceTimersByTimeAsync(999);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spawnProcess).toHaveBeenCalledTimes(2);

      // Four further crashes cross MAX_CONSECUTIVE_FAILURES (5).
      meter.onProcessFailure();
      await vi.advanceTimersByTimeAsync(2_000);
      meter.onProcessFailure();
      await vi.advanceTimersByTimeAsync(4_000);
      meter.onProcessFailure();
      await vi.advanceTimersByTimeAsync(8_000);
      meter.onProcessFailure();
      await vi.advanceTimersByTimeAsync(16_000);
      expect(meter.state).toBe('disabled');
      expect(spawnProcess).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles error and exit from one child only once before restarting', async () => {
    vi.useFakeTimers();
    try {
      const { meter, child, spawnProcess } = makeMeter({});
      await meter.start();

      child.emit('exit', 1);
      child.emit('error', new Error('app-server unavailable'));

      expect(meter.consecutiveFailures).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spawn when the codex version predates app-server', async () => {
    const { meter, spawnProcess, execFileAsync } = makeMeter({});
    execFileAsync.mockImplementation((_cmd, _args, _opts, cb) => cb(null, 'codex-cli 0.132.0'));

    await meter.start();

    expect(meter.state).toBe('stopped');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('treats a timed-out read as a process failure: kills the child and schedules one restart', async () => {
    vi.useFakeTimers();
    try {
      const { meter, child, spawnProcess } = makeMeter({ meterOptions: { requestTimeoutMs: 10 } });
      await meter.start();
      expect(spawnProcess).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(11);

      expect(meter.pendingReads.size).toBe(0);
      expect(meter.consecutiveFailures).toBe(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(meter.state).toBe('starting');
      expect(spawnProcess).toHaveBeenCalledTimes(1); // scheduled, not yet fired

      await vi.advanceTimersByTimeAsync(1_000);
      expect(spawnProcess).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the re-entry guard when the timed-out child exits after the read failure', async () => {
    vi.useFakeTimers();
    try {
      const { meter, child } = makeMeter({ meterOptions: { requestTimeoutMs: 10 } });
      await meter.start();

      await vi.advanceTimersByTimeAsync(11);
      expect(meter.consecutiveFailures).toBe(1);

      child.emit('exit', 1);
      expect(meter.consecutiveFailures).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables itself after five consecutive read timeouts and spawns no further processes', async () => {
    vi.useFakeTimers();
    try {
      const { meter, spawnProcess } = makeMeter({ meterOptions: { requestTimeoutMs: 10 } });
      await meter.start();

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await vi.advanceTimersByTimeAsync(11); // the in-flight read times out
        if (attempt < 5) await vi.advanceTimersByTimeAsync(1_000 * 2 ** (attempt - 1)); // backoff → respawn
      }

      expect(meter.state).toBe('disabled');
      expect(spawnProcess).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(300_000);
      expect(spawnProcess).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the failure streak and records delivery when a read maps', async () => {
    const { meter, child } = makeMeter({ meterOptions: { requestTimeoutMs: 10 } });
    await meter.start();
    expect(meter.lastDeliveredAt).toBeNull();

    await respondToLastRead(child, { rateLimits: RATE_LIMIT_SNAPSHOT });

    expect(meter.consecutiveFailures).toBe(0);
    expect(meter.lastDeliveredAt).toBe(1_789_855_000_000);
    expect(meter.healthy).toBe(true);
  });

  it('reports healthy only while mapped deliveries stay inside the stream freshness window', async () => {
    let now = 1_789_855_000_000;
    const meter = new CodexAppServerMeter({
      getObserver: () => null,
      modelProviders: { getEnabledForAllowances: () => [] },
      clock: { now: () => now },
      spawnProcess: vi.fn(() => createFakeAppServer()),
      execFileAsync: vi.fn((_cmd, _args, _opts, cb) => cb(null, 'codex-cli 0.145.0')),
    });
    _setActiveCodexAppServerMeterForTests(meter);
    try {
      await meter.start();
      // Alive but never delivered: not yet a trusted single writer.
      expect(isCodexAppServerMeterHealthy()).toBe(false);

      await respondToLastRead(meter.process, { rateLimits: RATE_LIMIT_SNAPSHOT });
      expect(isCodexAppServerMeterHealthy()).toBe(true);

      now += getStreamStaleAfterMs() + 1;
      expect(isCodexAppServerMeterHealthy()).toBe(false);

      // The meter is still alive, so a push notification can prove it
      // responsive again and restore the precedence signal.
      meter.process.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'account/rateLimits/updated', params: {} })}\n`));
      await respondToLastRead(meter.process, { rateLimits: RATE_LIMIT_SNAPSHOT });
      expect(isCodexAppServerMeterHealthy()).toBe(true);
    } finally {
      _setActiveCodexAppServerMeterForTests(null);
      await meter.stop();
    }
  });
});

describe('meter server lifecycle singleton', () => {
  afterEach(async () => {
    await stopCodexAppServerMeter();
    _setActiveCodexAppServerMeterForTests(null);
  });

  it('is not healthy while the source gate is off', async () => {
    const originalFlag = process.env.PROVIDER_ALLOWANCES_CODEX_APPSERVER;
    delete process.env.PROVIDER_ALLOWANCES_CODEX_APPSERVER;
    try {
      await startCodexAppServerMeter({ getObserver: () => null });

      expect(isCodexAppServerMeterHealthy()).toBe(false);
    } finally {
      if (originalFlag !== undefined) process.env.PROVIDER_ALLOWANCES_CODEX_APPSERVER = originalFlag;
    }
  });

  it('reports health from the active singleton and stops it on shutdown', async () => {
    const stop = vi.fn();
    _setActiveCodexAppServerMeterForTests({ healthy: true, stop });

    expect(isCodexAppServerMeterHealthy()).toBe(true);

    await stopCodexAppServerMeter();

    expect(stop).toHaveBeenCalledOnce();
    expect(isCodexAppServerMeterHealthy()).toBe(false);
  });
});
