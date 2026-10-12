import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getProviderAllowances } = vi.hoisted(() => ({ getProviderAllowances: vi.fn() }));
vi.mock('../composables/useApi.js', () => ({ api: { getProviderAllowances } }));

import { isAttention, lowestAllowance, prioritizeSnapshots, useProviderAllowancesStore } from './providerAllowances.js';

const snapshot = (providerId = 'openai-default', status = 'available', lastUsedAt = null) => ({
  providerId, providerName: providerId, providerKind: 'openai', status, allowances: [],
  source: null, updatedAt: null, staleAt: null, lastUsedAt, unavailableReason: null,
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

  it('holds dialog order on recency when live updates move providers into attention states', () => {
    // Intentional inversion of the old "attention jumps queue" behavior:
    // status changes alone never reorder; only recency does.
    const store = useProviderAllowancesStore();
    getProviderAllowances.mockResolvedValue({
      snapshots: [snapshot('a', 'available', 3000), snapshot('b', 'available', 2000), snapshot('c', 'available', 1000)],
      activeProviderIds: [],
    });

    return store.fetch().then(() => {
      store.replace(snapshot('c', 'warning', 1000));
      expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b', 'c']);

      store.replace(snapshot('b', 'exhausted', 2000));
      expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b', 'c']);

      // A genuinely recent provider moves to top.
      store.replace(snapshot('c', 'warning', 4000));
      expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['c', 'a', 'b']);
    });
  });

  it('preserves the stored recency when a live update carries no lastUsedAt', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a', 'available', 3000), snapshot('b', 'available', 2000)];

    // A stale-cached server may broadcast without recency; that must never
    // reset the stored value to null.
    store.replace({ ...snapshot('b', 'exhausted'), lastUsedAt: null });

    expect(store.snapshots.find(({ providerId }) => providerId === 'b'))
      .toMatchObject({ status: 'exhausted', lastUsedAt: 2000 });
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b']);
  });

  it('pins the attention badge set to warning, critical, and exhausted only', () => {
    // FRD §7.3 / AC-3 reconciliation: the badge counts exactly these three
    // states (code wins, FRD follows). Critical is deliberately included —
    // a provider at ≤10% needs attention as much as an exhausted one.
    expect(['warning', 'critical', 'exhausted'].map((status) => isAttention({ status }))).toEqual([true, true, true]);
    expect(['available', 'unknown', 'stale'].map((status) => isAttention({ status }))).toEqual([false, false, false]);

    const store = useProviderAllowancesStore();
    store.snapshots = [
      snapshot('a', 'warning'),
      snapshot('b', 'critical'),
      snapshot('c', 'exhausted'),
      snapshot('d', 'available'),
      snapshot('e', 'unknown'),
      snapshot('f', 'stale'),
    ];
    expect(store.attentionCount).toBe(3);
  });

  it('sorts snapshots by recency with never-used last and stable ties', () => {
    const snapshots = [
      snapshot('never-a'), snapshot('old', 'available', 1000), snapshot('recent', 'available', 3000),
      snapshot('never-b'), snapshot('tie', 'warning', 1000),
    ];

    // The warning tie keeps configured order behind the equally recent
    // healthy provider: severity never reorders the dialog.
    expect(prioritizeSnapshots(snapshots).map(({ providerId }) => providerId))
      .toEqual(['recent', 'old', 'tie', 'never-a', 'never-b']);
  });

  it('keeps a recovered provider at its recency position instead of leaving an attention group', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('c', 'critical', 1000), snapshot('a', 'available', 3000), snapshot('b', 'warning', 2000)];

    store.replace(snapshot('b', 'available', 2000));

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b', 'c']);
  });

  it('preserves the server recency order after fetching', async () => {
    const store = useProviderAllowancesStore();
    getProviderAllowances.mockResolvedValue({
      snapshots: [snapshot('recent', 'available', 3000), snapshot('older', 'warning', 2000), snapshot('never', 'available')],
      activeProviderIds: ['recent'],
    });

    await store.fetch();

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['recent', 'older', 'never']);
    expect(store.activeProviderIds).toEqual(['recent']);
  });

  it('converges REST reconciliation and subsequent websocket updates on one deduplicated recency order', async () => {
    const store = useProviderAllowancesStore();
    getProviderAllowances.mockResolvedValue({
      snapshots: [snapshot('a', 'available', 3000), snapshot('b', 'available', 2000), snapshot('c', 'warning', 1000)],
      activeProviderIds: ['b'],
    });

    await store.fetch();
    store.replace(snapshot('a', 'exhausted', 3000));
    store.replace({ ...snapshot('b', 'warning'), lastUsedAt: null });

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b', 'c']);
    expect(store.snapshots).toHaveLength(3);
    expect(new Set(store.snapshots.map(({ providerId }) => providerId)).size).toBe(3);
  });

  it('derives attention and the lowest non-null percentage from server-normalized statuses', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [
      snapshot('a', 'warning'),
      snapshot('b', 'critical'),
      {
        ...snapshot('c', 'available'),
        allowances: [{ key: 'requests', label: 'Requests', remaining: 30, limit: 100, remainingPercent: 30, unit: 'requests', resetsAt: null }],
      },
    ];
    expect(store.attentionCount).toBe(2);
    expect(store.snapshots.find(({ providerId }) => providerId === 'c')).toMatchObject({ status: 'available', allowances: [{ remainingPercent: 30 }] });
    expect(isAttention(snapshot('d', 'exhausted'))).toBe(true);
    expect(isAttention(snapshot('d', 'unknown'))).toBe(false);
    expect(lowestAllowance({ allowances: [{ remainingPercent: null }, { remainingPercent: 20 }, { remainingPercent: 10 }] }).remainingPercent).toBe(10);
  });

  it('marks snapshots stale at their staleAt boundary while preserving status', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = useProviderAllowancesStore();
    store.replace({ ...snapshot(), status: 'warning', staleAt: 200 });

    vi.advanceTimersByTime(100);

    expect(store.snapshots[0]).toMatchObject({ status: 'warning', stale: true });
  });

  it('orders a stale-critical provider by recency while keeping it in the badge after refreshStaleness', () => {
    // Intentional inversion of the old attention-first order: the recently
    // used healthy provider sorts first, but staleness stays an overlay so
    // the idle provider still reads as stale-critical for the badge.
    vi.useFakeTimers();
    vi.setSystemTime(300);
    const store = useProviderAllowancesStore();
    store.snapshots = [
      { ...snapshot('a'), status: 'available', staleAt: null, lastUsedAt: 3000 },
      { ...snapshot('b'), status: 'critical', staleAt: 200, lastUsedAt: 1000 },
    ];

    store.refreshStaleness();

    expect(store.snapshots.find(({ providerId }) => providerId === 'b'))
      .toMatchObject({ status: 'critical', stale: true });
    expect(store.attentionCount).toBe(1);
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b']);
  });

  it('does not drop a critical provider from the badge when it goes stale on the timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = useProviderAllowancesStore();
    store.replace({ ...snapshot(), status: 'critical', staleAt: 200 });
    expect(store.attentionCount).toBe(1);

    vi.advanceTimersByTime(100);

    expect(store.snapshots[0]).toMatchObject({ status: 'critical', stale: true });
    expect(store.attentionCount).toBe(1);
  });

  it('schedules and clears staleness timers under the overlay shape', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const store = useProviderAllowancesStore();
    store.replace({ ...snapshot('a'), status: 'warning', staleAt: 200 });
    expect(store.staleTimer).not.toBeNull();

    store.replace({ ...snapshot('a'), status: 'warning', staleAt: null });
    expect(store.staleTimer).toBeNull();
  });

  it('does not let an in-flight fetch clobber a websocket update', async () => {
    const store = useProviderAllowancesStore();
    let resolveFetch;
    getProviderAllowances.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    const fetchPromise = store.fetch();
    store.replace(snapshot('openai-default', 'critical'));
    resolveFetch({ snapshots: [snapshot('openai-default', 'available')], activeProviderIds: [] });
    await fetchPromise;

    expect(store.snapshots[0].status).toBe('critical');
  });
});
