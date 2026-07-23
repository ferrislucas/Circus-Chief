import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { executeCodexCli } from './codexCliRunner.js';

function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.stdin = { end: vi.fn() };
  return child;
}

function emitLine(child, jsonObj) {
  child.stdout.push(`${JSON.stringify(jsonObj)}\n`);
}

async function collectEvents(generator) {
  const events = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('codexCliRunner startup timeout', () => {
  let child;
  let markCliUnavailable;

  beforeEach(() => {
    vi.useFakeTimers();
    child = createMockChild();
    markCliUnavailable = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hang: throws CODEX_CLI_STARTUP_TIMEOUT and kills the child when no mapped event arrives', async () => {
    const gen = executeCodexCli(
      child,
      { prompt: 'Hi' },
      { model: 'gpt-5-codex', startupTimeoutMs: 50 },
      markCliUnavailable,
    );

    const resultPromise = collectEvents(gen);
    // Attach the rejection expectation before advancing timers so the
    // rejection is never briefly "unhandled" from Node's perspective.
    const assertion = expect(resultPromise).rejects.toMatchObject({ code: 'CODEX_CLI_STARTUP_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('healthy: no timeout fires once a mapped event is received before the window elapses', async () => {
    const gen = executeCodexCli(
      child,
      { prompt: 'Hi' },
      { model: 'gpt-5-codex', startupTimeoutMs: 50 },
      markCliUnavailable,
    );

    const resultPromise = collectEvents(gen);
    // Emit the first mapped event before the startup timer fires.
    await vi.advanceTimersByTimeAsync(10);
    emitLine(child, { type: 'thread.started', thread_id: 'thread-1' });
    await vi.advanceTimersByTimeAsync(5);
    child.emit('exit', 0);

    // Let the remainder of the startup window elapse with no timeout thrown.
    await vi.advanceTimersByTimeAsync(100);

    const events = await resultPromise;
    expect(child.kill).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'system')).toBe(true);
  });

  it('abort wins: aborting before the startup timer fires does not surface CODEX_CLI_STARTUP_TIMEOUT', async () => {
    const controller = new AbortController();
    const gen = executeCodexCli(
      child,
      { prompt: 'Hi' },
      { model: 'gpt-5-codex', startupTimeoutMs: 50, abortController: controller },
      markCliUnavailable,
    );

    const resultPromise = collectEvents(gen);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    // Simulate the child exiting in response to the SIGTERM from the abort handler.
    child.emit('exit', 0);

    // Advance well past the startup window; the timer must have been cleared.
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toBeDefined();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('disabled: startupTimeoutMs 0 never schedules a timeout', async () => {
    const gen = executeCodexCli(
      child,
      { prompt: 'Hi' },
      { model: 'gpt-5-codex', startupTimeoutMs: 0 },
      markCliUnavailable,
    );

    const resultPromise = collectEvents(gen);
    // Advance far beyond the default 30s window with no mapped event or exit.
    await vi.advanceTimersByTimeAsync(60000);
    expect(child.kill).not.toHaveBeenCalled();

    // Clean up the still-pending generator by ending the child.
    child.emit('exit', 0);
    await expect(resultPromise).resolves.toBeDefined();
  });
});
