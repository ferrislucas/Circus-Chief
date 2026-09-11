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
    pinned: project.pinned ?? false,
  };
}

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    currentProject: null,
    loading: false,
    error: null,
    pendingPinIds: [],
  }),

  getters: {
    getProjectById: (state) => (id) => state.projects.find((p) => p.id === id),

    /**
     * Facets for the status filter. The running badge is a session total;
     * waiting and idle remain project counts because their filters operate on
     * projects. The server supplies mutually exclusive running and waiting
     * session counts; idle is the complement of any active session.
     */
    statusFacets: (state) => {
      let running = 0;
      let waiting = 0;
      let idle = 0;
      for (const project of state.projects) {
        const isRunning = project.runningSessionCount > 0;
        const isWaiting = project.waitingSessionCount > 0;
        running += project.runningSessionCount;
        if (isWaiting) waiting += 1;
        if (!isRunning && !isWaiting) idle += 1;
      }
      return { running, waiting, idle };
    },

    pinnedFacet: (state) => state.projects.filter((project) => project.pinned).length,

    isPinPending: (state) => (id) => state.pendingPinIds.includes(id),

    /** Projects visible under the current status filter from `projectFilters`. */
    filteredProjects() {
      const filters = useProjectFiltersStore();
      if (filters.pinnedOnly) return this.projects.filter((project) => project.pinned);
      return this.projects.filter((project) => project.pinned || matchesStatus(project, filters.statusFilter));
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

    async toggleProjectPin(id) {
      if (this.pendingPinIds.includes(id)) return;
      const index = this.projects.findIndex((project) => project.id === id);
      if (index === -1) return;

      const previous = this.projects[index];
      const nextPinned = !previous.pinned;
      this.pendingPinIds.push(id);
      this.projects[index] = { ...previous, pinned: nextPinned };
      if (this.currentProject?.id === id) this.currentProject = this.projects[index];

      try {
        const updated = normalizeProject(await api.updateProject(id, { pinned: nextPinned }));
        this.projects[index] = updated;
        if (this.currentProject?.id === id) this.currentProject = updated;
        return updated;
      } catch (err) {
        this.projects[index] = previous;
        if (this.currentProject?.id === id) this.currentProject = previous;
        throw err;
      } finally {
        this.pendingPinIds = this.pendingPinIds.filter((pendingId) => pendingId !== id);
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

function matchesStatus(project, status) {
  if (!status) return true;
  if (status === 'running') return project.runningSessionCount > 0;
  if (status === 'waiting') return project.waitingSessionCount > 0;
  return project.runningSessionCount === 0 && project.waitingSessionCount === 0;
}
