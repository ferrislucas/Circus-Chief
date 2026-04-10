import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useTemplatesStore = defineStore('templates', {
  state: () => ({
    projectTemplates: [],
    globalTemplates: [],
    loading: false,
    error: null,
  }),

  getters: {
    allTemplates: (state) => [...state.projectTemplates, ...state.globalTemplates],
    getTemplateById: (state) => (id) => (
        state.projectTemplates.find((t) => t.id === id) ||
        state.globalTemplates.find((t) => t.id === id)
      ),
  },

  actions: {
    async fetchProjectTemplates(projectId) {
      this.loading = true;
      this.error = null;
      try {
        const result = await api.getProjectTemplates(projectId);
        this.projectTemplates = result.project || [];
        this.globalTemplates = result.global || [];
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async createProjectTemplate(projectId, data) {
      this.loading = true;
      this.error = null;
      try {
        const template = await api.createProjectTemplate(projectId, data);
        this.projectTemplates.unshift(template);
        return template;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async createGlobalTemplate(data) {
      this.loading = true;
      this.error = null;
      try {
        const template = await api.createGlobalTemplate(data);
        this.globalTemplates.unshift(template);
        return template;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateTemplate(id, data) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateTemplate(id, data);
        // Update in project templates
        let index = this.projectTemplates.findIndex((t) => t.id === id);
        if (index !== -1) {
          this.projectTemplates[index] = updated;
        } else {
          // Update in global templates
          index = this.globalTemplates.findIndex((t) => t.id === id);
          if (index !== -1) {
            this.globalTemplates[index] = updated;
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

    async deleteTemplate(id) {
      this.loading = true;
      this.error = null;
      try {
        await api.deleteTemplate(id);
        this.projectTemplates = this.projectTemplates.filter((t) => t.id !== id);
        this.globalTemplates = this.globalTemplates.filter((t) => t.id !== id);
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
