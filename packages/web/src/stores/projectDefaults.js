import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useProjectDefaultsStore = defineStore('projectDefaults', {
  state: () => ({
    defaultsByProjectId: {}, // Map of projectId -> defaults
    loading: false,
    error: null,
  }),

  getters: {
    getDefaultsForProject: (state) => (projectId) => {
      return state.defaultsByProjectId[projectId] || null;
    },
  },

  actions: {
    async fetchDefaults(projectId) {
      this.loading = true;
      this.error = null;
      try {
        const defaults = await api.getProjectSessionDefaults(projectId);
        this.defaultsByProjectId[projectId] = defaults;
        return defaults;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateDefaults(projectId, data) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateProjectSessionDefaults(projectId, data);
        this.defaultsByProjectId[projectId] = updated;
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async resetDefaults(projectId) {
      this.loading = true;
      this.error = null;
      try {
        await api.resetProjectSessionDefaults(projectId);
        // After reset, defaults will have all null fields
        this.defaultsByProjectId[projectId] = {
          mode: null,
          thinkingEnabled: null,
          startImmediately: null,
          gitMode: null,
          gitBranch: null,
          model: null,
        };
        return this.defaultsByProjectId[projectId];
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    clearProjectDefaults(projectId) {
      delete this.defaultsByProjectId[projectId];
    },

    clearAllDefaults() {
      this.defaultsByProjectId = {};
    },
  },
});
