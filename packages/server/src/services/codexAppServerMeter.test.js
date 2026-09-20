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

const RATE_LIMIT_SNAPSHOT = {
  limit_id: 'codex',
  primary: { used_percent: 17, window_minutes: 300, resets_at: 1_789_856_117 },
  secondary: { used_percent: 83, window_minutes: 10080, resets_at: 1_789_959_005 },
};

function createFakeChild() {
  return {
    stdin: { write: vi.fn(() => true) },
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  };
}

function respondToLastRead(child, result) {
  const writeCall = child.stdin.write.mock.calls.at(-1)[0];
  const { id } = JSON.parse(writeCall);
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`));
  // Allow the read continuation (promise resolution → observer) to run.
  return new Promise((resolve) => setImmediate(resolve));
}

function makeMeter(overrides = {}) {
  const child = createFakeChild();
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

  it('does not spawn when the codex version predates app-server', async () => {
    const { meter, spawnProcess, execFileAsync } = makeMeter({});
    execFileAsync.mockImplementation((_cmd, _args, _opts, cb) => cb(null, 'codex-cli 0.132.0'));

    await meter.start();

    expect(meter.state).toBe('stopped');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('clears timed-out reads without crashing the meter', async () => {
    vi.useFakeTimers();
    try {
      const { meter } = makeMeter({ meterOptions: { requestTimeoutMs: 10 } });
      await meter.start();

      await vi.advanceTimersByTimeAsync(11);

      expect(meter.pendingReads.size).toBe(0);
      expect(meter.healthy).toBe(true);
    } finally {
      vi.useRealTimers();
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
