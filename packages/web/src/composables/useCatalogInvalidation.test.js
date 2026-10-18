import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

const wsHandlers = {};
let reconnectHandlers = [];
const mockTiersStore = { fetchTiers: vi.fn(), lastFetchSucceeded: true };
const mockProvidersStore = { fetchProviders: vi.fn(), lastFetchSucceeded: true };

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((type, cb) => { wsHandlers[type] = cb; }),
    off: vi.fn((type) => { delete wsHandlers[type]; }),
    onReconnect: vi.fn((cb) => { reconnectHandlers.push(cb); return () => { reconnectHandlers = reconnectHandlers.filter((entry) => entry !== cb); }; }),
  }),
}));

vi.mock('../stores/tiers.js', () => ({
  useTiersStore: () => mockTiersStore,
}));

vi.mock('../stores/providers.js', () => ({
  useProvidersStore: () => mockProvidersStore,
}));

import { useCatalogInvalidation } from './useCatalogInvalidation.js';

function emit(payload) {
  wsHandlers[WS_MESSAGE_TYPES.CATALOG_INVALIDATED](payload);
}

function reconnect() {
  for (const cb of [...reconnectHandlers]) cb();
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

// Microtask-only flush: safe under fake timers (no setTimeout involved).
async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * Client B converges without a reload: a catalog mutation on client A is
 * broadcast, and client B refetches canonical state through the monotonic
 * store path and reconciles its selectors.
 */
describe('useCatalogInvalidation', () => {
  let shared;
  beforeEach(() => {
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    reconnectHandlers = [];
    vi.clearAllMocks();
    mockTiersStore.failTimes = 0;
    mockProvidersStore.failTimes = 0;
    mockTiersStore.lastFetchSucceeded = true;
    mockProvidersStore.lastFetchSucceeded = true;
    mockTiersStore.fetchTiers.mockImplementation(async () => {
      // Sticky failure budget: fails while failTimes remains, so retries can
      // be observed failing AND recovering deterministically.
      if (mockTiersStore.failTimes > 0) {
        mockTiersStore.failTimes -= 1;
        mockTiersStore.lastFetchSucceeded = false;
      } else {
        mockTiersStore.lastFetchSucceeded = true;
      }
      return [];
    });
    mockProvidersStore.fetchProviders.mockImplementation(async () => {
      if (mockProvidersStore.failTimes > 0) {
        mockProvidersStore.failTimes -= 1;
        mockProvidersStore.lastFetchSucceeded = false;
      } else {
        mockProvidersStore.lastFetchSucceeded = true;
      }
      return [];
    });
    shared = useCatalogInvalidation();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches only tiers for a tiers-scoped invalidation', async () => {
    emit({ scope: 'tiers', revision: 1 });
    await flush();

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
    expect(mockProvidersStore.fetchProviders).not.toHaveBeenCalled();
  });

  it('refetches providers AND tiers for a providers-scoped invalidation', async () => {
    // Tier availability derives from provider/model eligibility, so a
    // providers-scoped invalidation must refresh the tier catalog too —
    // otherwise another client's selectors keep offering a tier whose last
    // usable model was just disabled or removed.
    emit({ scope: 'providers', revision: 1 });
    await flush();

    expect(mockProvidersStore.fetchProviders).toHaveBeenCalledTimes(1);
    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate revisions (idempotent delivery)', async () => {
    emit({ scope: 'tiers', revision: 7 });
    await flush();
    emit({ scope: 'tiers', revision: 7 });
    await flush();

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('ignores delayed and out-of-order revisions so older state never wins', async () => {
    emit({ scope: 'tiers', revision: 10 });
    await flush();
    emit({ scope: 'tiers', revision: 9 });
    await flush();
    emit({ scope: 'tiers', revision: 10 });
    await flush();

    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('a newer revision after an older one refetches again (convergence)', async () => {
    emit({ scope: 'providers', revision: 3 });
    await flush();
    emit({ scope: 'providers', revision: 4 });
    await flush();

    expect(mockProvidersStore.fetchProviders).toHaveBeenCalledTimes(2);
    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(2);
  });

  // ── Finding 9: recovery after reconnect and refresh failure ──

  it('refetches both catalogs on reconnect even when already loaded', async () => {
    reconnect();
    await flush();

    expect(mockProvidersStore.fetchProviders).toHaveBeenCalledTimes(1);
    expect(mockTiersStore.fetchTiers).toHaveBeenCalledTimes(1);
  });

  it('recovers a failed invalidation refresh with a bounded retry and no newer mutation', async () => {
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20] });

    mockTiersStore.failTimes = 1;
    emit({ scope: 'tiers', revision: 1 });
    await vi.runAllTimersAsync();

    // First attempt failed; the bounded retry recovered without another event.
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
  });

  it('keeps a failed scope dirty while a newer event succeeds for another scope', async () => {
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20] });

    // Revision 1 (providers scope) fails its providers half; tiers converges.
    mockProvidersStore.failTimes = 1;
    emit({ scope: 'providers', revision: 1 });
    await flushMicrotasks();
    expect(mockProvidersStore.fetchProviders.mock.calls.length).toBe(1);
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(1);

    // Revision 2 (tiers scope) arrives while the providers retry is pending
    // and succeeds. The older failed providers scope must still recover —
    // the newer event refreshes tiers but never discards providers' dirt.
    emit({ scope: 'tiers', revision: 2 });
    await vi.runAllTimersAsync();

    expect(mockProvidersStore.fetchProviders.mock.calls.length).toBe(2);
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
  });

  it('a newer invalidation does not discard an older failed scope', async () => {
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20, 30] });

    // Providers refresh fails twice before recovering.
    mockProvidersStore.failTimes = 2;
    emit({ scope: 'providers', revision: 1 });
    await flushMicrotasks();
    expect(mockProvidersStore.fetchProviders.mock.calls.length).toBe(1);

    // A newer tiers-only event arrives mid-recovery and succeeds...
    emit({ scope: 'tiers', revision: 2 });
    await vi.runAllTimersAsync();

    // ...yet the older failed providers scope still recovered through retry.
    expect(mockProvidersStore.fetchProviders.mock.calls.length).toBe(3);
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
  });

  // ── Finding 13: a newer invalidation must survive an older in-flight refresh ──

  it('a newer invalidation arriving mid-fetch forces another fetch', async () => {
    // Revision 1 starts a tiers GET that stays in flight; the server takes
    // its snapshot, then another client deletes a tier and revision 2
    // arrives before the old response settles. The stale success must not
    // clear revision 2's dirt: a second GET converges to canonical state.
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20] });

    const gate = deferred();
    let calls = 0;
    mockTiersStore.fetchTiers.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate.promise;
      mockTiersStore.lastFetchSucceeded = true;
      return [];
    });

    emit({ scope: 'tiers', revision: 1 });
    await flushMicrotasks();
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(1);

    emit({ scope: 'tiers', revision: 2 });
    await flushMicrotasks();
    gate.resolve();
    await vi.runAllTimersAsync();

    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
  });

  it('a reconnect arriving mid-fetch forces another fetch', async () => {
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20] });

    const gate = deferred();
    let calls = 0;
    mockTiersStore.fetchTiers.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) await gate.promise;
      mockTiersStore.lastFetchSucceeded = true;
      return [];
    });

    emit({ scope: 'tiers', revision: 1 });
    await flushMicrotasks();
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(1);

    // Mutations may have landed while disconnected; the reconnect refresh
    // must not be lost when the older GET settles.
    reconnect();
    await flushMicrotasks();
    gate.resolve();
    await vi.runAllTimersAsync();

    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
  });

  it('a providers-scoped revision mid-tiers-fetch refetches tiers without extra providers fetches', async () => {
    // Revision 1 starts a tiers GET that stays in flight; revision 2
    // (providers scope, which refreshes both catalogs) arrives before the
    // old tiers response settles. The stale tiers success must not clear
    // revision 2's dirt, while providers — never fetched yet — converges
    // with exactly one GET.
    vi.useFakeTimers();
    shared.dispose();
    useCatalogInvalidation({ retryDelays: [10, 20] });

    const gate = deferred();
    let tierCalls = 0;
    mockTiersStore.fetchTiers.mockImplementation(async () => {
      tierCalls += 1;
      if (tierCalls === 1) await gate.promise;
      mockTiersStore.lastFetchSucceeded = true;
      return [];
    });

    emit({ scope: 'tiers', revision: 1 });
    await flushMicrotasks();
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(1);

    emit({ scope: 'providers', revision: 2 });
    await flushMicrotasks();
    gate.resolve();
    await vi.runAllTimersAsync();

    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(2);
    expect(mockProvidersStore.fetchProviders.mock.calls.length).toBe(1);
  });

  it('dispose removes the reconnect listener and stops pending retries', async () => {
    vi.useFakeTimers();
    shared.dispose();
    const { dispose } = useCatalogInvalidation({ retryDelays: [10, 20] });
    expect(reconnectHandlers).toHaveLength(1);

    // The refresh keeps failing; retries are pending.
    mockTiersStore.failTimes = 99;
    emit({ scope: 'tiers', revision: 1 });
    await flushMicrotasks();
    const callsAtDispose = mockTiersStore.fetchTiers.mock.calls.length;
    expect(callsAtDispose).toBe(1);

    dispose();
    expect(reconnectHandlers).toHaveLength(0);

    // No further retries, no reconnect refreshes, no invalidation refreshes.
    // (The invalidation listener is gone, so emit would throw — guard it.)
    mockTiersStore.failTimes = 0;
    await vi.runAllTimersAsync();
    reconnect();
    if (wsHandlers[WS_MESSAGE_TYPES.CATALOG_INVALIDATED]) {
      emit({ scope: 'tiers', revision: 2 });
      await vi.runAllTimersAsync();
    }
    expect(mockTiersStore.fetchTiers.mock.calls.length).toBe(callsAtDispose);
  });
});
