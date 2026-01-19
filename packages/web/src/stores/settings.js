import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    tokenCostWeights: { ...DEFAULT_TOKEN_COST_WEIGHTS },
    loading: false,
    error: null,
  }),

  getters: {
    /**
     * Get the current token cost weights
     */
    weights: (state) => state.tokenCostWeights,
  },

  actions: {
    /**
     * Fetch token cost weights from the server
     */
    async fetchTokenCostWeights() {
      this.loading = true;
      this.error = null;
      try {
        const weights = await api.getTokenCostWeights();
        this.tokenCostWeights = weights;
      } catch (err) {
        this.error = err.message;
        // Fall back to defaults on error
        this.tokenCostWeights = { ...DEFAULT_TOKEN_COST_WEIGHTS };
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update token cost weights
     * @param {Object} weights - New token cost weights
     */
    async updateTokenCostWeights(weights) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateTokenCostWeights(weights);
        this.tokenCostWeights = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset token cost weights to defaults
     */
    async resetTokenCostWeights() {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.resetTokenCostWeights();
        this.tokenCostWeights = defaults;
        return defaults;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
