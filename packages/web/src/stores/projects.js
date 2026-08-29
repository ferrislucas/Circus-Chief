import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useProjectFiltersStore } from './projectFilters.js';

/**
 * Normalize a project so the running-workspace fields are always present,
 * even when served by an older server that omits them.
 */
function normalizeProject(project) {
  return {
    ...project,
    workspaceCount: project.workspaceCount ?? 0,
    runningWorkspaces: project.runningWorkspaces ?? [],
    runningSessionCount: project.runningSessionCount ?? 0,
    waitingSessionCount: project.waitingSessionCount ?? 0,
  };
}

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    currentProject: null,
    loading: false,
    error: null,
  }),

  getters: {
    getProjectById: (state) => (id) => state.projects.find((p) => p.id === id),

    /**
     * Facets for the status filter — project counts, not session/workspace
     * counts. `running` and `waiting` may overlap (a project with both counts
     * toward both); `idle` is the complement of "any active session".
     */
    statusFacets: (state) => {
      let running = 0;
      let waiting = 0;
      let idle = 0;
      for (const project of state.projects) {
        const isRunning = project.runningSessionCount > 0;
        const isWaiting = project.waitingSessionCount > 0;
        if (isRunning) running += 1;
        if (isWaiting) waiting += 1;
        if (!isRunning && !isWaiting) idle += 1;
      }
      return { running, waiting, idle };
    },

    /** Projects visible under the current status filter from `projectFilters`. */
    filteredProjects() {
      const filter = useProjectFiltersStore().statusFilter;
      if (filter === 'running') {
        return this.projects.filter((p) => p.runningSessionCount > 0);
      }
      if (filter === 'waiting') {
        return this.projects.filter((p) => p.waitingSessionCount > 0);
      }
      if (filter === 'idle') {
        return this.projects.filter((p) => p.runningSessionCount === 0 && p.waitingSessionCount === 0);
      }
      return this.projects;
    },
  },

  actions: {
    async fetchProjects({ silent = false } = {}) {
      if (!silent) {
        this.loading = true;
        this.error = null;
      }
      try {
        const projects = await api.getProjects();
        this.projects = projects.map(normalizeProject);
      } catch (err) {
        // A silent refresh (realtime) must not clear an already-rendered list
        // nor surface its error through the shared error flag.
        if (!silent) {
          this.error = err.message;
        }
      } finally {
        if (!silent) {
          this.loading = false;
        }
      }
    },

    async fetchProject(id) {
      this.loading = true;
      this.error = null;
      try {
        const project = normalizeProject(await api.getProject(id));
        this.currentProject = project;
        // Also add to projects array if not already present (for getProjectById)
        if (!this.projects.find((p) => p.id === id)) {
          this.projects.push(project);
        }
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
        const project = normalizeProject(await api.createProject(data));
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
        const updated = normalizeProject(await api.updateProject(id, data));
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
