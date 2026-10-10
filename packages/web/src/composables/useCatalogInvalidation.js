import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useWebSocket } from './useWebSocket.js';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';

const DEFAULT_RETRY_DELAYS = [1000, 3000, 10000];

/**
 * Refresh engine behind `useCatalogInvalidation`: tracks received-but-not-
 * yet-successfully-refreshed scopes and converges them through a bounded,
 * coalesced retry with backoff.
 *
 * - A failed scope stays dirty; only a successful refresh clears it, so a
 *   newer event never discards an older failed scope.
 * - Finding 13: each scope carries an invalidation generation. A trigger
 *   that lands while that scope's fetch is in flight bumps the generation,
 *   and the settling response clears only the generation it covered — so a
 *   newer invalidation (or reconnect) always forces another fetch instead
 *   of being erased by a stale success.
 * - Stale responses cannot overwrite newer state: the stores' monotonic
 *   intake remains the single ordering rule for writes.
 * - A pending backoff is woken early by fresh triggers (no unbounded loop:
 *   each trigger runs one pass plus a bounded retry budget).
 */
function createCatalogRefreshEngine({ fetchScope, retryDelays }) {
  const dirtyScopes = new Map();
  let disposed = false;
  let refreshInFlight = null;
  let needsRerun = false;
  let retryTimer = null;
  let wakeRetry = null;
  let retryIndex = 0;

  function clearRetryWait() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    wakeRetry = null;
  }

  function waitForRetry(delay) {
    return new Promise((resolve) => {
      clearRetryWait();
      wakeRetry = resolve;
      retryTimer = setTimeout(() => {
        wakeRetry = null;
        retryTimer = null;
        resolve();
      }, delay);
    });
  }

  function wakePendingRetry() {
    if (wakeRetry) {
      const wake = wakeRetry;
      clearRetryWait();
      wake();
    }
  }

  // One pass over the currently dirty scopes. True when every scope
  // refreshed successfully.
  async function refreshDirtyOnce() {
    for (const scope of [...dirtyScopes.keys()]) {
      if (disposed) return false;
      const generation = dirtyScopes.get(scope);
      const ok = await fetchScope(scope);
      if (disposed) return false;
      // Clear only the generation covered by this request: a trigger that
      // landed mid-fetch bumped the generation, so the scope stays dirty
      // and is fetched again below.
      if (ok && dirtyScopes.get(scope) === generation) dirtyScopes.delete(scope);
    }
    return dirtyScopes.size === 0;
  }

  // One loop cycle. True when the loop should continue.
  async function pumpRefreshCycle() {
    needsRerun = false;
    if (disposed) return false;
    if (await refreshDirtyOnce()) {
      retryIndex = 0;
      return needsRerun;
    }
    if (disposed) return false;
    if (needsRerun) {
      // Scopes remain only because a newer invalidation or reconnect landed
      // mid-pass: refetch promptly with a fresh budget instead of backing off.
      retryIndex = 0;
      return true;
    }
    if (retryIndex >= retryDelays.length) {
      // Budget spent: stop retrying, but stay dirty so the next
      // invalidation or reconnect recovers without another mutation.
      return false;
    }
    await waitForRetry(retryDelays[retryIndex++]);
    return !disposed;
  }

  async function runRefresh() {
    if (refreshInFlight) {
      needsRerun = true;
      wakePendingRetry();
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        // Work happens inside pumpRefreshCycle; the loop only repeats it.
        while (await pumpRefreshCycle()) { /* converge dirty scopes */ }
      } finally {
        clearRetryWait();
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  function markDirty(scopes) {
    for (const scope of scopes) dirtyScopes.set(scope, (dirtyScopes.get(scope) ?? 0) + 1);
  }

  function requestRefresh() {
    if (disposed) return;
    // A fresh trigger restarts the retry budget and wakes a pending backoff
    // so recovery is prompt.
    retryIndex = 0;
    if (refreshInFlight) {
      needsRerun = true;
      wakePendingRetry();
      return;
    }
    void runRefresh();
  }

  function dispose() {
    disposed = true;
    // Release a pending backoff waiter; the cycle re-checks `disposed`
    // before any further fetch, so disposed callbacks can never initiate
    // another refresh.
    if (wakeRetry) {
      const wake = wakeRetry;
      clearRetryWait();
      wake();
    } else {
      clearRetryWait();
    }
  }

  return { markDirty, requestRefresh, dispose };
}

/**
 * Consume versioned model-catalog invalidations (`catalog:invalidated`).
 *
 * Installed once at the app root. A catalog mutation on ANY client is
 * broadcast with a strictly increasing revision; this client refetches the
 * named scope through the stores' monotonic intake path (item 3), so
 * selectors converge without a reload and active selections reconcile
 * against canonical state via `describeSelectionProblem`.
 *
 * Revision guard: only a revision NEWER than the last received one refetches.
 * Duplicate, delayed, and out-of-order deliveries are idempotent no-ops.
 *
 * Finding 9 — recovery:
 * - Every reconnect refetches BOTH catalogs through the same monotonic
 *   intake: mutations missed during a disconnect (a deleted tier, a disabled
 *   last-usable model) converge without a reload or another mutation, even
 *   when the catalogs were already loaded.
 * - Received revisions are tracked separately from successfully refreshed
 *   state: a failed scope stays dirty and recovers through the engine's
 *   bounded retry, woken early by reconnects and newer invalidations.
 */
export function useCatalogInvalidation({ retryDelays = DEFAULT_RETRY_DELAYS } = {}) {
  const { on, off, onReconnect } = useWebSocket();
  const tiersStore = useTiersStore();
  const providersStore = useProvidersStore();
  const engine = createCatalogRefreshEngine({
    fetchScope: async (scope) => {
      // The stores resolve with cached data on failure (existing callers
      // depend on that), so success is read from the explicit
      // `lastFetchSucceeded` signal — never inferred from the return value.
      // A throw (should the contract ever change) counts as failure too.
      try {
        if (scope === 'providers') await providersStore.fetchProviders();
        else await tiersStore.fetchTiers();
      } catch {
        return false;
      }
      const store = scope === 'providers' ? providersStore : tiersStore;
      return store?.lastFetchSucceeded !== false;
    },
    retryDelays,
  });
  let lastReceivedRevision = 0;

  function scopesFor(scope) {
    if (scope === 'providers') {
      // Finding 10: tier availability derives from provider/model
      // eligibility, so a providers-scoped invalidation refreshes the tier
      // catalog too — through the same monotonic intake path, keeping the
      // revision guard above as the single ordering rule. Tiers-scoped
      // events keep their narrower scope below.
      return ['providers', 'tiers'];
    }
    if (scope === 'tiers') return ['tiers'];
    return ['providers', 'tiers'];
  }

  function handleCatalogInvalidated(message) {
    const revision = typeof message?.revision === 'number' ? message.revision : 0;
    if (!(revision > lastReceivedRevision)) return;
    lastReceivedRevision = revision;
    engine.markDirty(scopesFor(message?.scope));
    engine.requestRefresh();
  }

  function handleReconnect() {
    // Mutations may have landed while disconnected with no replay — refetch
    // both catalogs even when already loaded.
    engine.markDirty(['providers', 'tiers']);
    engine.requestRefresh();
  }

  on(WS_MESSAGE_TYPES.CATALOG_INVALIDATED, handleCatalogInvalidated);
  const removeReconnectListener = typeof onReconnect === 'function'
    ? onReconnect(handleReconnect)
    : null;

  function dispose() {
    engine.dispose();
    off(WS_MESSAGE_TYPES.CATALOG_INVALIDATED, handleCatalogInvalidated);
    removeReconnectListener?.();
  }

  return { dispose };
}
