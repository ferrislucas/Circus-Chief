import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    items: [],
    selectedItemId: null,
    loading: false,
    error: null,
  }),

  getters: {
    // Group items by filename, return latest of each with version info
    groupedItems: (state) => {
      const groups = {};
      for (const item of state.items) {
        const key = item.filename || item.label || item.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      return Object.values(groups)
        .map((versions) => {
          versions.sort((a, b) => b.createdAt - a.createdAt);
          return {
            ...versions[0],
            versionCount: versions.length,
            allVersions: versions,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    selectedItem: (state) => state.items.find((i) => i.id === state.selectedItemId),

    // Get all versions for the selected item's filename
    selectedItemVersions: (state) => {
      const selected = state.items.find((i) => i.id === state.selectedItemId);
      if (!selected) return [];
      const key = selected.filename || selected.label || selected.id;
      return state.items
        .filter((i) => (i.filename || i.label || i.id) === key)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
  },

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
        // Clear selection if deleted item was selected
        if (this.selectedItemId === itemId) {
          this.selectedItemId = null;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async deleteGroup(sessionId, filename) {
      const toDelete = this.items.filter(
        (i) => (i.filename || i.label || i.id) === filename
      );
      for (const item of toDelete) {
        await this.deleteItem(sessionId, item.id);
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
      // Clear selection if removed item was selected
      if (this.selectedItemId === itemId) {
        this.selectedItemId = null;
      }
    },

    selectItem(itemId) {
      this.selectedItemId = itemId;
    },

    clearSelection() {
      this.selectedItemId = null;
    },
  },
});
