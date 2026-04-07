import { defineStore, getActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';

/**
 * Counter for generating unique store IDs across multiple overlay instances.
 */
let overlayTodosCounter = 0;

/**
 * Factory that creates an isolated Pinia todos store for the overlay.
 * Mirrors the main todos store exactly but with an independent instance
 * so that overlay todo state does not contaminate the main view.
 */
export function createOverlayTodosStore() {
  const storeId = `overlay-todos-${++overlayTodosCounter}`;

  const store = defineStore(storeId, {
    state: () => ({
      items: [],
      loading: false,
      error: null,
      expanded: false,
      currentConversationId: null,
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
  })();

  // Attach $cleanup() to properly dispose and remove from Pinia registry.
  // $dispose() alone only removes subscriptions — it does NOT remove the
  // store's state entry from pinia.state.value, leaking memory on every
  // overlay open/close cycle.
  store.$cleanup = () => {
    store.$dispose();
    const pinia = getActivePinia();
    if (pinia) delete pinia.state.value[storeId];
  };

  return store;
}
