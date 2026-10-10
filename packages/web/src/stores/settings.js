import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { DEFAULT_MUSE_MODEL, DEFAULT_TOKEN_COST_WEIGHTS } from '@circuschief/shared';

export const MUSE_PROBE_DEFAULT_MODEL = DEFAULT_MUSE_MODEL;

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    tokenCostWeights: { ...DEFAULT_TOKEN_COST_WEIGHTS },
    summarySettings: {
      disableSessionSummaries: false,
      sessionTitlePrompt: '',
      summaryModel: '',
      summaryProviderId: null,
      defaultSessionTitlePrompt: '', // Default prompt from server
    },
    generalSettings: {
      disableAnalytics: false,
    },
    museProbeSettings: {
      probeModel: DEFAULT_MUSE_MODEL,
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
          sessionTitlePrompt: '',
          summaryModel: '',
          summaryProviderId: null,
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
     * Fetch Muse usage probe settings from the server
     */
    async fetchMuseProbeSettings() {
      this.loading = true;
      this.error = null;
      try {
        const settings = await api.getMuseProbeSettings();
        this.museProbeSettings = settings;
        return settings;
      } catch (err) {
        this.error = err.message;
        // Fall back to defaults on error
        this.museProbeSettings = {
          probeModel: DEFAULT_MUSE_MODEL,
        };
        return this.museProbeSettings;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update Muse usage probe settings
     * @param {Object} settings - Probe settings
     */
    async updateMuseProbeSettings(settings) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateMuseProbeSettings(settings);
        this.museProbeSettings = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset Muse usage probe settings to defaults
     */
    async resetMuseProbeSettings() {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.resetMuseProbeSettings();
        this.museProbeSettings = defaults;
        return defaults;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch general settings from the server
     */
    async fetchGeneralSettings() {
      this.loading = true;
      this.error = null;
      try {
        const settings = await api.getGeneralSettings();
        this.generalSettings = settings;
      } catch (err) {
        this.error = err.message;
        // Fall back to defaults on error
        this.generalSettings = {
          disableAnalytics: false,
        };
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update general settings
     * @param {Object} settings - General settings
     */
    async updateGeneralSettings(settings) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateGeneralSettings(settings);
        this.generalSettings = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset general settings to defaults
     */
    async resetGeneralSettings() {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.resetGeneralSettings();
        this.generalSettings = defaults;
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
