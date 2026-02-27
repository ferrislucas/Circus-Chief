import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useAgentLogsStore = defineStore('agentLogs', {
  state: () => ({
    logs: [],
    pagination: { total: 0, limit: 25, offset: 0, hasMore: false },
    filters: {
      agentType: null,
      callType: null,
      status: null,
      model: null,
      startDate: null,
      endDate: null,
      sessionId: null,
    },
    filterOptions: {
      agentTypes: [],
      callTypes: [],
      statuses: [],
      models: [],
    },
    perPage: 25,
    currentPage: 1,
    sortBy: 'started_at',
    sortOrder: 'DESC',
    loading: false,
    error: null,
  }),

  getters: {
    totalPages: (state) => Math.ceil(state.pagination.total / state.perPage) || 0,
    activeFilters: (state) => {
      const active = {};
      for (const [key, value] of Object.entries(state.filters)) {
        if (value != null) active[key] = value;
      }
      return active;
    },
  },

  actions: {
    async fetchLogs() {
      this.loading = true;
      this.error = null;
      try {
        const offset = (this.currentPage - 1) * this.perPage;
        const result = await api.getAgentCallLogs({
          limit: this.perPage,
          offset,
          ...this.activeFilters,
          sortBy: this.sortBy,
          sortOrder: this.sortOrder,
        });
        this.logs = result.logs;
        this.pagination = result.pagination;
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchFilterOptions() {
      try {
        const options = await api.getAgentCallFilterOptions();
        this.filterOptions = options;
      } catch (err) {
        console.error('Failed to fetch filter options:', err);
        // Silently fail - dropdowns will just be empty
      }
    },

    setFilter(key, value) {
      this.filters[key] = value || null;
      this.currentPage = 1;
      this.fetchLogs();
    },

    clearFilters() {
      Object.keys(this.filters).forEach((k) => (this.filters[k] = null));
      this.currentPage = 1;
      this.fetchLogs();
    },

    setPage(page) {
      this.currentPage = page;
      this.fetchLogs();
    },

    setPerPage(perPage) {
      this.perPage = perPage;
      this.currentPage = 1;
      this.fetchLogs();
    },

    setSort(sortBy, sortOrder) {
      this.sortBy = sortBy;
      this.sortOrder = sortOrder;
      this.currentPage = 1;
      this.fetchLogs();
    },
  },
});
