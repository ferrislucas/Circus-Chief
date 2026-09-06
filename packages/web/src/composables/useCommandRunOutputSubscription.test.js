import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { subscribeCommandRunOutput } from './useCommandRunOutputSubscription.js';

// The subscription composable talks to a real WebSocket by default. For these
// unit-level checks, register a no-op socket so listeners and control frames
// can be sent safely; live socket behavior is covered by the E2E suite.
vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({ send: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));

describe('useCommandRunOutputSubscription', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCommandButtonsStore();
  });

  it('skips the catch-up sync for a finished run that already holds output but no cursor (no re-append duplication)', () => {
    // Scenario behind the flaky "output persisting across tabs" test failure:
    // the run completed while the pane was collapsed, so its text arrived via
    // the plain output path and outputHighWater was never recorded. A fresh
    // subscribe over cursor 0 would otherwise re-append the entire stream.
    store.runs['run-1'] = {
      runId: 'run-1',
      buttonId: 'btn-1',
      sessionId: 'sess-1',
      status: 'success',
      output: 'Persist output',
      exitCode: 0,
      outputTruncated: false,
      // NOTE: no outputHighWater on purpose
    };
    store.syncRunOutput = vi.fn().mockResolvedValue({ highWater: 0, hasMore: false });

    const unsubscribe = subscribeCommandRunOutput('sess-1', 'run-1');

    // The terminal-run guard must prevent the fetch-and-append path entirely.
    expect(store.syncRunOutput).not.toHaveBeenCalled();

    unsubscribe();
    expect(store.runs['run-1'].output).toBe('Persist output');
  });

  it('still syncs when the completed run has no buffered output yet', () => {
    // A completed run whose output was never loaded must keep the normal
    // fetch-and-append path so expanding the pane shows the content.
    store.runs['run-1'] = {
      runId: 'run-1',
      buttonId: 'btn-1',
      sessionId: 'sess-1',
      status: 'success',
      output: '',
      exitCode: 0,
      outputTruncated: false,
    };
    store.syncRunOutput = vi.fn().mockResolvedValue({ highWater: 1, hasMore: false });

    const unsubscribe = subscribeCommandRunOutput('sess-1', 'run-1');

    expect(store.syncRunOutput).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('keeps the catch-up sync for running runs, even when output is already buffered', () => {
    // A live run still needs sync (gap repair + live chunks); the guard only
    // applies to terminal runs.
    store.runs['run-1'] = {
      runId: 'run-1',
      buttonId: 'btn-1',
      sessionId: 'sess-1',
      status: 'running',
      output: 'partial',
      exitCode: null,
      outputTruncated: false,
    };
    store.syncRunOutput = vi.fn().mockResolvedValue({ highWater: 1, hasMore: false });

    const unsubscribe = subscribeCommandRunOutput('sess-1', 'run-1');

    expect(store.syncRunOutput).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('subscribes with a persisted cursor when the run entry already carries one', () => {
    // Layer A keeps the store cursor up to date on completion; a re-subscribe
    // (e.g. tab switch) must hand that cursor to the sync rather than 0.
    store.runs['run-1'] = {
      runId: 'run-1',
      buttonId: 'btn-1',
      sessionId: 'sess-1',
      status: 'success',
      output: 'Persist output',
      exitCode: 0,
      outputTruncated: false,
      outputHighWater: 7,
    };
    store.syncRunOutput = vi.fn(async (_sessionId, _runId, after, applyChunk) => ({
      highWater: after,
      hasMore: false,
    }));

    const unsubscribe = subscribeCommandRunOutput('sess-1', 'run-1');

    expect(store.syncRunOutput).toHaveBeenCalledTimes(1);
    expect(store.syncRunOutput.mock.calls[0][2]).toBe(7);

    unsubscribe();
  });
});