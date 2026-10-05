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
import { describeSelectionProblem, isSelectionSubmittable } from '../composables/modelSelectionReconciliation.js';

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
      expect(store.loaded).toBe(true);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('captures errors', async () => {
      mockApi.getTiers.mockRejectedValue(new Error('boom'));

      const store = useTiersStore();
      await store.fetchTiers();

      expect(store.error).toBe('boom');
      expect(store.tiers).toEqual([]);
      expect(store.loaded).toBe(false);
    });

    it('ignores a stale response that resolves after a newer fetch', async () => {
      let resolveStale;
      let resolveFresh;
      mockApi.getTiers
        .mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }))
        .mockImplementationOnce(() => new Promise((r) => { resolveFresh = r; }));

      const store = useTiersStore();
      const stale = store.fetchTiers();
      const fresh = store.fetchTiers();
      resolveFresh([{ id: 'new', name: 'New', members: [] }]);
      await fresh;
      resolveStale([{ id: 'old', name: 'Old', members: [] }]);
      await stale;

      expect(store.tiers).toEqual([{ id: 'new', name: 'New', members: [] }]);
      expect(store.loaded).toBe(true);
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
        { id: 't2', name: 'Full', members: [{ id: 'm1', available: true }] },
      ];
      expect(store.tiersWithMembers).toEqual([{ id: 't2', name: 'Full', members: [{ id: 'm1', available: true }] }]);
    });

    it('tiersWithMembers excludes tiers whose members are all unusable (deleted/disabled providers)', () => {
      const store = useTiersStore();
      const unusable = { id: 't1', name: 'Dead', members: [{ id: 'm1', providerId: 'gone', available: false }] };
      const usable = { id: 't2', name: 'Live', members: [{ id: 'm2', providerId: 'p1', available: true }] };
      store.tiers = [unusable, usable];
      // Same shared "is this tier selectable" predicate the selector and the
      // save-path guard judge through — member count alone is not usability.
      expect(store.tiersWithMembers).toEqual([usable]);
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

  // Finding 10 — cross-client availability convergence without reload.
  //
  // Another client disables (or removes) this client's tier's last usable
  // model; the providers-scoped invalidation makes this client refetch tiers
  // through the monotonic intake path. The selector set (`tiersWithMembers`,
  // judged through the shared `isTierSelectable` predicate) and the save
  // guard (`describeSelectionProblem`) must converge on the refreshed
  // canonical catalog — and converge back when the model is restored —
  // without a reload. A stale (slower, older) response resolving after newer
  // availability must never undo it.
  describe('availability convergence (finding 10)', () => {
    const MEMBER = { id: 'm1', providerId: 'p1', modelId: 'model-a', position: 0 };
    const selection = () => ({ model: buildTierRef('gold'), providerId: null });
    const catalogOf = (store) => ({
      tiers: store.tiers,
      tiersLoaded: store.loaded,
      providers: [],
      providersLoaded: true,
    });

    async function fetchCatalog(store, available) {
      mockApi.getTiers.mockResolvedValue([
        {
          id: 'gold',
          name: 'Gold',
          members: available === 'removed' ? [] : [{ ...MEMBER, available }],
        },
      ]);
      await store.fetchTiers();
    }

    it('selectors and save guards converge when the last usable model is disabled, then restored', async () => {
      const store = useTiersStore();

      await fetchCatalog(store, true);
      expect(store.tiersWithMembers.map((tier) => tier.id)).toEqual(['gold']);
      expect(describeSelectionProblem(selection(), catalogOf(store))).toBeNull();
      expect(isSelectionSubmittable(selection(), catalogOf(store))).toBe(true);

      // Another client disables the last usable model.
      await fetchCatalog(store, false);
      expect(store.tiersWithMembers).toEqual([]);
      expect(describeSelectionProblem(selection(), catalogOf(store))).toMatchObject({ code: 'tier-unusable' });
      expect(isSelectionSubmittable(selection(), catalogOf(store))).toBe(false);

      // ...then removes it entirely: still converged, no reload involved.
      await fetchCatalog(store, 'removed');
      expect(store.tiersWithMembers).toEqual([]);
      expect(describeSelectionProblem(selection(), catalogOf(store))).toMatchObject({ code: 'tier-unusable' });

      // Restored: selectors offer the tier and the save guard clears again.
      await fetchCatalog(store, true);
      expect(store.tiersWithMembers.map((tier) => tier.id)).toEqual(['gold']);
      expect(describeSelectionProblem(selection(), catalogOf(store))).toBeNull();
      expect(isSelectionSubmittable(selection(), catalogOf(store))).toBe(true);
    });

    it('a stale response resolving after newer availability never undoes it', async () => {
      let resolveStale;
      let resolveFresh;
      mockApi.getTiers
        .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));

      const store = useTiersStore();
      const unavailable = [{ id: 'gold', name: 'Gold', members: [{ ...MEMBER, available: false }] }];
      const restored = [{ id: 'gold', name: 'Gold', members: [{ ...MEMBER, available: true }] }];
      const stale = store.fetchTiers();
      const fresh = store.fetchTiers();
      resolveFresh(restored);
      await fresh;
      resolveStale(unavailable);
      await stale;

      expect(store.tiersWithMembers.map((tier) => tier.id)).toEqual(['gold']);
      expect(describeSelectionProblem(selection(), catalogOf(store))).toBeNull();
    });
  });
});
