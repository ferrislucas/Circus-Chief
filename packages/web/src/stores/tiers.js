import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
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

    /** Tiers that have at least one member (shown in selectors) */
    tiersWithMembers: (state) => state.tiers.filter((t) => t.members && t.members.length > 0),

    /** Build a tier ref sentinel string from a tier id */
    asTierRef: () => (id) => buildTierRef(id),
  },

  actions: {
    async fetchTiers() {
      this.loading = true;
      this.error = null;
      try {
        this.tiers = await api.getTiers();
        this.loaded = true;
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async createTier(data) {
      this.loading = true;
      this.error = null;
      try {
        const tier = await api.createTier(data);
        this.tiers.push(tier);
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
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
