import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    tokenCostWeights: { ...DEFAULT_TOKEN_COST_WEIGHTS },
    summarySettings: {
      disableSessionSummaries: false,
      disableConversationSummaries: false,
      sessionTitlePrompt: '',
      defaultSessionTitlePrompt: '', // Default prompt from server
    },
    privacySettings: {
      disableAnalytics: false,
    },
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

    /**
     * Fetch summary settings from the server
     */
    async fetchSummarySettings() {
      this.loading = true;
      this.error = null;
      try {
        const settings = await api.getSummarySettings();
        this.summarySettings = settings;
      } catch (err) {
        this.error = err.message;
        // Fall back to defaults on error
        this.summarySettings = {
          disableSessionSummaries: false,
          disableConversationSummaries: false,
          sessionTitlePrompt: '',
          defaultSessionTitlePrompt: '',
        };
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update summary settings
     * @param {Object} settings - Summary settings
     */
    async updateSummarySettings(settings) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateSummarySettings(settings);
        this.summarySettings = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset summary settings to defaults
     */
    async resetSummarySettings() {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.resetSummarySettings();
        this.summarySettings = defaults;
        return defaults;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch privacy settings from the server
     */
    async fetchPrivacySettings() {
      this.loading = true;
      this.error = null;
      try {
        const settings = await api.getPrivacySettings();
        this.privacySettings = settings;
      } catch (err) {
        this.error = err.message;
        // Fall back to defaults on error
        this.privacySettings = {
          disableAnalytics: false,
        };
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update privacy settings
     * @param {Object} settings - Privacy settings
     */
    async updatePrivacySettings(settings) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updatePrivacySettings(settings);
        this.privacySettings = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset privacy settings to defaults
     */
    async resetPrivacySettings() {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.resetPrivacySettings();
        this.privacySettings = defaults;
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
