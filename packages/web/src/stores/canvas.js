import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    items: [],
    trashedItems: [],
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

    // Group trashed items by filename, return latest of each with version info
    groupedTrashedItems: (state) => {
      const groups = {};
      for (const item of state.trashedItems) {
        const key = item.filename || item.label || item.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      return Object.values(groups)
        .map((versions) => {
          versions.sort((a, b) => b.deletedAt - a.deletedAt);
          return {
            ...versions[0],
            versionCount: versions.length,
            allVersions: versions,
          };
        })
        .sort((a, b) => b.deletedAt - a.deletedAt);
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
        const deletedItem = await api.deleteCanvasItem(sessionId, itemId);
        this.items = this.items.filter((i) => i.id !== itemId);
        this.trashedItems.unshift(deletedItem);
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
    },

    async fetchTrashedItems(sessionId) {
      this.error = null;
      try {
        this.trashedItems = await api.getCanvasTrash(sessionId);
      } catch (err) {
        this.error = err.message;
      }
    },

    async recoverItem(sessionId, itemId) {
      this.error = null;
      try {
        const item = await api.recoverCanvasItem(sessionId, itemId);
        this.trashedItems = this.trashedItems.filter((i) => i.id !== itemId);
        this.items.unshift(item);
        return item;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async recoverFile(sessionId, filename) {
      this.error = null;
      try {
        await api.recoverCanvasFile(sessionId, filename);
        // Refresh both lists
        await this.fetchItems(sessionId);
        await this.fetchTrashedItems(sessionId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async permanentlyDeleteItem(sessionId, itemId) {
      this.error = null;
      try {
        await api.permanentlyDeleteCanvasItem(sessionId, itemId);
        this.trashedItems = this.trashedItems.filter((i) => i.id !== itemId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },
  },
});
