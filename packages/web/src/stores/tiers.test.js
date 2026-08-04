import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ── Mock api (hoisted so it's defined before vi.mock runs) ────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getTiers: vi.fn(),
    getTier: vi.fn(),
    createTier: vi.fn(),
    updateTier: vi.fn(),
    deleteTier: vi.fn(),
  },
}));

vi.mock('../composables/useApi.js', () => ({
  api: mockApi,
}));

// Import after mocking
import { useTiersStore, isTierRef, buildTierRef } from './tiers.js';

describe('useTiersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetchTiers', () => {
    it('populates tiers on success', async () => {
      const tiers = [
        { id: 't1', name: 'High', members: [{ id: 'm1', providerId: 'p1', modelId: 'x', position: 0 }] },
      ];
      mockApi.getTiers.mockResolvedValue(tiers);

      const store = useTiersStore();
      await store.fetchTiers();

      expect(store.tiers).toEqual(tiers);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('captures errors', async () => {
      mockApi.getTiers.mockRejectedValue(new Error('boom'));

      const store = useTiersStore();
      await store.fetchTiers();

      expect(store.error).toBe('boom');
      expect(store.tiers).toEqual([]);
    });
  });

  describe('createTier', () => {
    it('appends the created tier to state', async () => {
      const created = { id: 't1', name: 'New', members: [] };
      mockApi.createTier.mockResolvedValue(created);

      const store = useTiersStore();
      const result = await store.createTier({ name: 'New', members: [] });

      expect(mockApi.createTier).toHaveBeenCalledWith({ name: 'New', members: [] });
      expect(result).toEqual(created);
      expect(store.tiers).toContainEqual(created);
    });

    it('propagates errors and sets store.error', async () => {
      mockApi.createTier.mockRejectedValue(new Error('duplicate name'));

      const store = useTiersStore();
      await expect(store.createTier({ name: 'Dup' })).rejects.toThrow('duplicate name');
      expect(store.error).toBe('duplicate name');
    });
  });

  describe('updateTier', () => {
    it('replaces the tier in state by id', async () => {
      const store = useTiersStore();
      store.tiers = [{ id: 't1', name: 'Old', members: [] }];

      const updated = { id: 't1', name: 'Renamed', members: [] };
      mockApi.updateTier.mockResolvedValue(updated);

      const result = await store.updateTier('t1', { name: 'Renamed' });

      expect(result).toEqual(updated);
      expect(store.tiers[0]).toEqual(updated);
    });
  });

  describe('deleteTier', () => {
    it('removes the tier from state', async () => {
      const store = useTiersStore();
      store.tiers = [{ id: 't1', name: 'ToDelete', members: [] }];
      mockApi.deleteTier.mockResolvedValue(undefined);

      await store.deleteTier('t1');

      expect(mockApi.deleteTier).toHaveBeenCalledWith('t1');
      expect(store.tiers).toEqual([]);
    });
  });

  describe('getters', () => {
    it('getById finds a tier by id', () => {
      const store = useTiersStore();
      store.tiers = [{ id: 't1', name: 'A', members: [] }, { id: 't2', name: 'B', members: [] }];
      expect(store.getById('t2')).toEqual({ id: 't2', name: 'B', members: [] });
      expect(store.getById('missing')).toBeUndefined();
    });

    it('tiersWithMembers filters out empty tiers', () => {
      const store = useTiersStore();
      store.tiers = [
        { id: 't1', name: 'Empty', members: [] },
        { id: 't2', name: 'Full', members: [{ id: 'm1' }] },
      ];
      expect(store.tiersWithMembers).toEqual([{ id: 't2', name: 'Full', members: [{ id: 'm1' }] }]);
    });

    it('asTierRef builds a tier ref string', () => {
      const store = useTiersStore();
      expect(store.asTierRef('abc123')).toBe('tier::abc123');
    });
  });

  describe('re-exported helpers', () => {
    it('isTierRef detects tier refs', () => {
      expect(isTierRef('tier::abc')).toBe(true);
      expect(isTierRef('claude-sonnet-5')).toBe(false);
    });

    it('buildTierRef builds the sentinel string', () => {
      expect(buildTierRef('abc')).toBe('tier::abc');
    });
  });
});
