import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('replaces a matching snapshot without changing the order of others', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a'), snapshot('b')];
    store.replace(snapshot('a', 'warning'));
    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['a', 'b']);
    expect(store.snapshots[0].status).toBe('warning');
  });

  it('preserves the server priority order after fetching', async () => {
    const store = useProviderAllowancesStore();
    getProviderAllowances.mockResolvedValue([snapshot('active'), snapshot('attention', 'warning'), snapshot('configured')]);

    await store.fetch();

    expect(store.snapshots.map(({ providerId }) => providerId)).toEqual(['active', 'attention', 'configured']);
  });

  it('derives attention and the lowest non-null percentage', () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot('a', 'warning'), snapshot('b', 'critical'), snapshot('c', 'available')];
    expect(store.attentionCount).toBe(2);
    expect(isAttention(snapshot('d', 'exhausted'))).toBe(true);
    expect(isAttention(snapshot('d', 'unknown'))).toBe(false);
    expect(lowestAllowance({ allowances: [{ remainingPercent: null }, { remainingPercent: 20 }, { remainingPercent: 10 }] }).remainingPercent).toBe(10);
  });
});
