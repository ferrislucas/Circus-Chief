import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useQuickResponsesStore = defineStore('quickResponses', {
  state: () => ({
    projectResponses: [],
    globalResponses: [],
    loading: false,
    error: null,
    currentProjectId: null,
  }),

  getters: {
    allResponses: (state) => [...state.projectResponses, ...state.globalResponses],
    hasResponses: (state) => state.projectResponses.length > 0 || state.globalResponses.length > 0,
  },

  actions: {
    /**
     * Fetch quick responses for a project (includes both project-specific and global)
     * @param {string} projectId - Project ID
     * @returns {Promise<{project: Array, global: Array}>}
     */
    async fetchForProject(projectId) {
      this.loading = true;
      this.error = null;
      this.currentProjectId = projectId;

      try {
        const responses = await api.getQuickResponses(projectId);
        this.projectResponses = responses.project;
        this.globalResponses = responses.global;
        return responses;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Create a new quick response
     * @param {string} projectId - Project ID
     * @param {Object} data - Quick response data
     * @returns {Promise<Object>}
     */
    async createResponse(projectId, data) {
      this.loading = true;
      this.error = null;

      try {
        const response = await api.createQuickResponse(projectId, data);

        // Add to appropriate list based on projectId
        if (response.projectId === null) {
          this.globalResponses.push(response);
        } else {
          this.projectResponses.push(response);
        }

        return response;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update an existing quick response
     * @param {string} id - Quick response ID
     * @param {Object} data - Update data
     * @returns {Promise<Object>}
     */
    async updateResponse(id, data) {
      this.loading = true;
      this.error = null;

      try {
        const updated = await api.updateQuickResponse(id, data);

        // Update in the appropriate list
        const projectIndex = this.projectResponses.findIndex((r) => r.id === id);
        if (projectIndex !== -1) {
          this.projectResponses[projectIndex] = updated;
        } else {
          const globalIndex = this.globalResponses.findIndex((r) => r.id === id);
          if (globalIndex !== -1) {
            this.globalResponses[globalIndex] = updated;
          }
        }

        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Delete a quick response
     * @param {string} id - Quick response ID
     * @returns {Promise<void>}
     */
    async deleteResponse(id) {
      this.loading = true;
      this.error = null;

      try {
        await api.deleteQuickResponse(id);

        // Remove from the appropriate list
        const projectIndex = this.projectResponses.findIndex((r) => r.id === id);
        if (projectIndex !== -1) {
          this.projectResponses.splice(projectIndex, 1);
        } else {
          const globalIndex = this.globalResponses.findIndex((r) => r.id === id);
          if (globalIndex !== -1) {
            this.globalResponses.splice(globalIndex, 1);
          }
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reorder quick responses
     * @param {string} projectId - Project ID (null for global)
     * @param {Array<string>} orderedIds - Array of IDs in desired order
     * @returns {Promise<void>}
     */
    async reorderResponses(projectId, orderedIds) {
      this.loading = true;
      this.error = null;

      try {
        const orders = orderedIds.map((id, index) => ({ id, sortOrder: index }));

        if (projectId) {
          const responses = await api.reorderQuickResponses(projectId, orders);
          this.projectResponses = responses.project;
          this.globalResponses = responses.global;
        } else {
          const responses = await api.reorderGlobalQuickResponses(orders);
          this.globalResponses = responses;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Clear all responses (for cleanup)
     */
    clearResponses() {
      this.projectResponses = [];
      this.globalResponses = [];
      this.currentProjectId = null;
      this.error = null;
    },
  },
});
