import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    currentProject: null,
    loading: false,
    error: null,
  }),

  getters: {
    getProjectById: (state) => (id) => {
      return state.projects.find((p) => p.id === id);
    },
  },

  actions: {
    async fetchProjects() {
      this.loading = true;
      this.error = null;
      try {
        this.projects = await api.getProjects();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchProject(id) {
      this.loading = true;
      this.error = null;
      try {
        this.currentProject = await api.getProject(id);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async createProject(data) {
      this.loading = true;
      this.error = null;
      try {
        const project = await api.createProject(data);
        this.projects.unshift(project);
        return project;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async updateProject(id, data) {
      this.loading = true;
      this.error = null;
      try {
        const updated = await api.updateProject(id, data);
        const index = this.projects.findIndex((p) => p.id === id);
        if (index !== -1) {
          this.projects[index] = updated;
        }
        if (this.currentProject?.id === id) {
          this.currentProject = updated;
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async deleteProject(id) {
      this.loading = true;
      this.error = null;
      try {
        await api.deleteProject(id);
        this.projects = this.projects.filter((p) => p.id !== id);
        if (this.currentProject?.id === id) {
          this.currentProject = null;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
