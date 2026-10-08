import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { isTierSelectable } from '../components/modelSelectorTiers.js';
import { isTierRef, buildTierRef } from '@circuschief/shared';

export { isTierRef, buildTierRef };

export const useTiersStore = defineStore('tiers', {
  state: () => ({
    tiers: [],
    loading: false,
    // An empty list is meaningful only after the first successful fetch. This
    // keeps a just-mounted selector from treating a still-loading tier ref as
    // deleted, while allowing the last deleted tier to become visibly stale.
    loaded: false,
    error: null,
  }),

  getters: {
    getById: (state) => (id) => state.tiers.find((t) => t.id === id),

    /** Tiers with at least one usable member (shown in selectors).
     *
     * Judged through the same shared `isTierSelectable` predicate the
     * selector (`tierSupportsProviderKinds`) and the save-path guard
     * (`describeSelectionProblem`) use, so the three cannot drift apart:
     * existence plus ≥1 `available` member. Kind-restricted pickers layer
     * their `allowedProviderKinds` through the same predicate at the
     * selector/guard level. */
    tiersWithMembers: (state) => state.tiers.filter((t) => isTierSelectable(t)),

    /** Build a tier ref sentinel string from a tier id */
    asTierRef: () => (id) => buildTierRef(id),
  },

  actions: {
    async fetchTiers() {
      // Monotonic intake: overlapping fetches (initial load, reconnect,
      // manual refresh, catalog-invalidation refetch) resolve in any order —
      // only the latest request may write state.
      const request = (this.fetchRevision = (this.fetchRevision || 0) + 1);
      this.loading = true;
      this.error = null;
      try {
        const tiers = await api.getTiers();
        if (request !== this.fetchRevision) return tiers;
        this.tiers = tiers;
        this.loaded = true;
        return tiers;
      } catch (err) {
        if (request === this.fetchRevision) this.error = err.message;
        return this.tiers;
      } finally {
        if (request === this.fetchRevision) this.loading = false;
      }
    },

    // Mutations share the fetch revision so a stale in-flight GET cannot
    // overwrite committed state: the server publishes catalog invalidation
    // after committing a mutation and before returning its response, so
    // overlapping reads resolve in either order. Bumping here retires any
    // GET that started before the mutation committed.
    bumpFetchRevision() {
      this.fetchRevision = (this.fetchRevision || 0) + 1;
    },

    async createTier(data) {
      this.loading = true;
      this.error = null;
      try {
        const tier = await api.createTier(data);
        // Identity-based upsert: an invalidation-triggered GET applied
        // before this response resolves already holds the same id.
        const index = this.tiers.findIndex((t) => t.id === tier.id);
        if (index !== -1) {
          this.tiers[index] = tier;
        } else {
          this.tiers.push(tier);
        }
        this.bumpFetchRevision();
        return tier;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateTier(id, data) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateTier(id, data);
        const index = this.tiers.findIndex((t) => t.id === id);
        if (index !== -1) {
          this.tiers[index] = updated;
        }
        this.bumpFetchRevision();
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async deleteTier(id) {
      this.loading = true;
      this.error = null;
      try {
        await api.deleteTier(id);
        this.tiers = this.tiers.filter((t) => t.id !== id);
        this.bumpFetchRevision();
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
