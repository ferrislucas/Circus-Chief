import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useTodosStore = defineStore('todos', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
    expanded: false,
    currentConversationId: null, // Track which conversation's todos we're showing
  }),

  getters: {
    hasTodos: (state) => state.items.length > 0,
    pendingCount: (state) => state.items.filter((t) => t.status === 'pending').length,
    inProgressCount: (state) => state.items.filter((t) => t.status === 'in_progress').length,
    completedCount: (state) => state.items.filter((t) => t.status === 'completed').length,
  },

  actions: {
    async fetchTodos(sessionId, conversationId = null) {
      this.loading = true;
      this.error = null;
      this.currentConversationId = conversationId;
      try {
        this.items = await api.getSessionTodos(sessionId, conversationId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    updateTodos(todos, conversationId = null) {
      // Only update if the conversation matches (or no tracking yet)
      if (conversationId === null || this.currentConversationId === null || conversationId === this.currentConversationId) {
        this.items = todos;
      }
    },

    clearTodos() {
      this.items = [];
      this.loading = false;
      this.error = null;
      this.currentConversationId = null;
      this.expanded = false;
    },

    toggleExpanded() {
      this.expanded = !this.expanded;
    },

    setExpanded(value) {
      this.expanded = value;
    },
  },
});
