import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useTodosStore = defineStore('todos', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
    expanded: false,
  }),

  getters: {
    hasTodos: (state) => state.items.length > 0,
    pendingCount: (state) => state.items.filter((t) => t.status === 'pending').length,
    inProgressCount: (state) => state.items.filter((t) => t.status === 'in_progress').length,
    completedCount: (state) => state.items.filter((t) => t.status === 'completed').length,
  },

  actions: {
    async fetchTodos(sessionId) {
      this.loading = true;
      this.error = null;
      try {
        this.items = await api.getSessionTodos(sessionId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    updateTodos(todos) {
      this.items = todos;
    },

    clearTodos() {
      this.items = [];
      this.loading = false;
      this.error = null;
    },

    toggleExpanded() {
      this.expanded = !this.expanded;
    },

    setExpanded(value) {
      this.expanded = value;
    },
  },
});
