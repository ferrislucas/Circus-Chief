import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getProviderAllowances } = vi.hoisted(() => ({ getProviderAllowances: vi.fn() }));
vi.mock('../composables/useApi.js', () => ({ api: { getProviderAllowances } }));

import { isAttention, lowestAllowance, useProviderAllowancesStore } from './providerAllowances.js';

const snapshot = (providerId = 'openai-default', status = 'available') => ({
  providerId, providerName: providerId, providerKind: 'openai', status, allowances: [],
  source: null, updatedAt: null, staleAt: null, unavailableReason: null,
});

describe('provider allowances store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getProviderAllowances.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('parses fetched snapshots before replacing state', async () => {
    const store = useProviderAllowancesStore();
    getProviderAllowances.mockResolvedValue([{ providerId: 'not-a-snapshot' }]);

    await store.fetch();

    expect(store.snapshots).toEqual([]);
    expect(store.error).toMatch(/provider allowance/i);
  });

  it('retains the last known snapshots when fetching fails', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot()];
    getProviderAllowances.mockRejectedValue(new Error('network down'));

    await store.fetch();

    expect(store.snapshots).toHaveLength(1);
    expect(store.error).toBe('network down');
  });

  it('reorders immediately when live updates move providers into attention states', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a'), snapshot('b'), snapshot('c')];

    store.replace(snapshot('c', 'warning'));
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['c', 'a', 'b']);

    store.replace(snapshot('b', 'exhausted'));
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['c', 'b', 'a']);
  });

  it('preserves the server priority order after fetching', async () => {
    const store = useProviderAllowancesStore();
    store.setActiveProviderIds(['active']);
    getProviderAllowances.mockResolvedValue([snapshot('active'), snapshot('attention', 'warning'), snapshot('configured')]);

    await store.fetch();

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['active', 'attention', 'configured']);
  });

  it('recomputes priority when active sessions start, stop, or switch providers', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a'), snapshot('b', 'warning'), snapshot('c')];

    store.setActiveProviderIds(['c']);
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['c', 'b', 'a']);

    store.setActiveProviderIds(['a']);
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b', 'c']);

    store.setActiveProviderIds([]);
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['b', 'a', 'c']);
  });

  it('converges REST reconciliation and subsequent websocket updates on one deduplicated order', async () => {
    const store = useProviderAllowancesStore();
    store.setActiveProviderIds(['b']);
    getProviderAllowances.mockResolvedValue([snapshot('a'), snapshot('b'), snapshot('c', 'warning')]);

    await store.fetch();
    store.replace(snapshot('a', 'exhausted'));
    store.replace(snapshot('b', 'warning'));

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['b', 'c', 'a']);
    expect(store.snapshots).toHaveLength(3);
    expect(new Set(store.snapshots.map(({ providerId }) => providerId)).size).toBe(3);
  });

  it('derives attention and the lowest non-null percentage', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a', 'warning'), snapshot('b', 'critical'), snapshot('c', 'available')];
    expect(store.attentionCount).toBe(2);
    expect(isAttention(snapshot('d', 'exhausted'))).toBe(true);
    expect(isAttention(snapshot('d', 'unknown'))).toBe(false);
    expect(lowestAllowance({ allowances: [{ remainingPercent: null }, { remainingPercent: 20 }, { remainingPercent: 10 }] }).remainingPercent).toBe(10);
  });

  it('marks snapshots stale at their staleAt boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = useProviderAllowancesStore();
    store.replace({ ...snapshot(), status: 'warning', staleAt: 200 });

    vi.advanceTimersByTime(100);

    expect(store.snapshots[0].status).toBe('stale');
  });

  it('does not let an in-flight fetch clobber a websocket update', async () => {
    const store = useProviderAllowancesStore();
    let resolveFetch;
    getProviderAllowances.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    const fetchPromise = store.fetch();
    store.replace(snapshot('openai-default', 'critical'));
    resolveFetch([snapshot('openai-default', 'available')]);
    await fetchPromise;

    expect(store.snapshots[0].status).toBe('critical');
  });
});
