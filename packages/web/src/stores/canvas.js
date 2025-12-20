import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    items: [],
    loading: false,
    error: null,
  }),

  actions: {
    async fetchItems(sessionId) {
      this.loading = true;
      this.error = null;
      try {
        this.items = await api.getCanvasItems(sessionId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async deleteItem(sessionId, itemId) {
      this.error = null;
      try {
        await api.deleteCanvasItem(sessionId, itemId);
        this.items = this.items.filter((i) => i.id !== itemId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async uploadItem(sessionId, file, label = null) {
      this.loading = true;
      this.error = null;
      try {
        const item = await api.uploadCanvasItem(sessionId, file, label);
        this.items.unshift(item);
        return item;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    addItem(item) {
      this.items.unshift(item);
    },

    removeItem(itemId) {
      this.items = this.items.filter((i) => i.id !== itemId);
    },
  },
});
