import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const SESSION_ID = 'session-1';
const RUN_ID = 'run-1';

/** Handlers registered through the mocked `useWebSocket().on`. */
let wsHandlers;
let sent;
let store;
let subscribeCommandRunOutput;

/** Deliver a socket frame to every handler registered for its type. */
function receive(type, payload) {
  for (const handler of wsHandlers.get(type) || []) handler(payload);
}

/** A promise plus its resolver, so a sync can be held open mid-test. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: (type, handler) => {
      if (!wsHandlers.has(type)) wsHandlers.set(type, []);
      wsHandlers.get(type).push(handler);
    },
    send: (type, payload) => sent.push({ type, payload }),
  }),
}));

vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: () => store,
}));

describe('subscribeCommandRunOutput', () => {
  beforeEach(async () => {
    wsHandlers = new Map();
    sent = [];
    store = {
      runs: { [RUN_ID]: { runId: RUN_ID, status: 'running', outputHighWater: 0 } },
      appendOutput: vi.fn(),
      syncCalls: [],
      syncRunOutput: vi.fn(),
    };
    // Module-level subscription bookkeeping must not leak between tests.
    vi.resetModules();
    ({ subscribeCommandRunOutput } = await import('./useCommandRunOutputSubscription.js'));
  });

  /** Subscribe and settle the initial catch-up read with no chunks. */
  async function subscribeAndSettleInitialSync() {
    store.syncRunOutput.mockResolvedValueOnce({ highWater: 0, hasMore: false });
    const unsubscribe = subscribeCommandRunOutput(SESSION_ID, RUN_ID);
    await vi.waitFor(() => expect(store.syncRunOutput).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    return unsubscribe;
  }

  it('subscribes on the socket and issues an initial catch-up read', async () => {
    await subscribeAndSettleInitialSync();

    expect(sent).toContainEqual({
      type: WS_MESSAGE_TYPES.SUBSCRIBE_COMMAND_RUN_OUTPUT,
      payload: { sessionId: SESSION_ID, runId: RUN_ID },
    });
    expect(store.syncRunOutput).toHaveBeenCalledWith(SESSION_ID, RUN_ID, 0, expect.any(Function));
  });

  it('applies in-order live chunks with completion-tolerant appends', async () => {
    await subscribeAndSettleInitialSync();

    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 1, content: 'LINE 1\n' });

    // Ordering and de-duplication live here (by sequence), so the store must
    // not second-guess a chunk that lands after the run is marked complete.
    expect(store.appendOutput).toHaveBeenCalledWith(RUN_ID, 'LINE 1\n', { allowAfterCompletion: true });
  });

  it('ignores chunks already covered by the current high-water mark', async () => {
    await subscribeAndSettleInitialSync();

    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 1, content: 'LINE 1\n' });
    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 1, content: 'LINE 1\n' });

    expect(store.appendOutput).toHaveBeenCalledTimes(1);
  });

  it('re-reads the persisted stream when a live sequence is missing', async () => {
    await subscribeAndSettleInitialSync();
    store.syncRunOutput.mockResolvedValueOnce({ highWater: 4, hasMore: false });

    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 5, content: 'LINE 5\n' });

    expect(store.appendOutput).not.toHaveBeenCalled();
    expect(store.syncRunOutput).toHaveBeenCalledTimes(2);
  });

  it('runs a follow-up read for chunks rejected while a read was in flight', async () => {
    await subscribeAndSettleInitialSync();

    const inFlight = deferred();
    store.syncRunOutput.mockReturnValueOnce(inFlight.promise);
    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 5, content: 'LINE 5\n' });
    expect(store.syncRunOutput).toHaveBeenCalledTimes(2);

    // This chunk is rejected while the read is open. It may have been persisted
    // after that read started, so dropping it here would lose it permanently.
    receive(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { runId: RUN_ID, sequence: 6, content: 'LINE 6\n' });
    expect(store.syncRunOutput).toHaveBeenCalledTimes(2);

    store.syncRunOutput.mockResolvedValueOnce({ highWater: 6, hasMore: false });
    inFlight.resolve({ highWater: 5, hasMore: false });

    await vi.waitFor(() => expect(store.syncRunOutput).toHaveBeenCalledTimes(3));
  });

  it('shares one socket subscription across viewers and releases it on the last unsubscribe', async () => {
    const unsubscribeA = await subscribeAndSettleInitialSync();
    const unsubscribeB = subscribeCommandRunOutput(SESSION_ID, RUN_ID);

    const subscribeFrames = sent.filter((f) => f.type === WS_MESSAGE_TYPES.SUBSCRIBE_COMMAND_RUN_OUTPUT);
    expect(subscribeFrames).toHaveLength(1);

    unsubscribeA();
    expect(sent.some((f) => f.type === WS_MESSAGE_TYPES.UNSUBSCRIBE_COMMAND_RUN_OUTPUT)).toBe(false);

    unsubscribeB();
    expect(sent).toContainEqual({
      type: WS_MESSAGE_TYPES.UNSUBSCRIBE_COMMAND_RUN_OUTPUT,
      payload: { runId: RUN_ID },
    });
  });
});
