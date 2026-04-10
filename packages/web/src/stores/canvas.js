import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    items: [],
    trashedItems: [],
    loading: false,
    error: null,
    selectedItemIds: new Set(),
    bulkOperationInProgress: false,
    editingSessionMap: {},  // { [filename]: latestItemId } — tracks "active editing session"
  }),

  getters: {
    selectedItemCount: (state) => state.selectedItemIds.size,

    isAllItemsSelected: (state) => {
      const uniqueFiles = new Set(state.items.map(i => i.filename || i.id));
      return uniqueFiles.size > 0 && state.selectedItemIds.size === uniqueFiles.size;
    },

    isPartialSelection: (state) => {
      const uniqueFiles = new Set(state.items.map(i => i.filename || i.id));
      return state.selectedItemIds.size > 0 && state.selectedItemIds.size < uniqueFiles.size;
    },

    selectedItems: (state) => state.items.filter(item => state.selectedItemIds.has(item.id)),

    // Group items by filename, return latest of each with version info
    groupedItems: (state) => {
      const groups = {};
      for (const item of state.items) {
        const key = item.filename || item.id;
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
        const key = item.filename || item.id;
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
        this.items = await api.getAllCanvasItems(sessionId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchItemContent(sessionId, filename) {
      // Check if already fetched (cache hit).
      // Use === undefined (NOT falsy check) because:
      //   - null is a valid fetched value (e.g., content is null for image items)
      //   - '' is a valid fetched value (empty text files)
      //   - undefined means the field was stripped by the list endpoint (not yet fetched)
      const existing = this.items.find(i => i.filename === filename);
      if (existing && (existing.content !== undefined || existing.data !== undefined)) {
        return { content: existing.content, data: existing.data };
      }

      const result = await api.getCanvasFileContent(sessionId, filename);
      // Patch the content/data into ALL matching items in the store (all versions of this file)
      for (const item of this.items) {
        if (item.filename === filename) {
          item.content = result.content;
          item.data = result.data;
        }
      }
      return result;
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
        (i) => (i.filename || i.id) === filename
      );
      for (const item of toDelete) {
        await this.deleteItem(sessionId, item.id);
      }
    },

    async uploadItem(sessionId, file) {
      this.loading = true;
      this.error = null;
      try {
        const item = await api.uploadCanvasItem(sessionId, file);
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

    // Selection actions
    toggleItemSelection(itemId) {
      if (this.selectedItemIds.has(itemId)) {
        this.selectedItemIds.delete(itemId);
      } else {
        this.selectedItemIds.add(itemId);
      }
    },

    selectAllItems() {
      const seen = new Set();
      for (const item of this.items) {
        const key = item.filename || item.id;
        if (!seen.has(key)) {
          seen.add(key);
          this.selectedItemIds.add(item.id);
        }
      }
    },

    deselectAllItems() {
      this.selectedItemIds.clear();
    },

    // Bulk delete items (soft delete - move to trash)
    async bulkDeleteItems(sessionId, itemIds) {
      this.bulkOperationInProgress = true;
      this.error = null;
      try {
        const result = await api.bulkDeleteCanvasItems(sessionId, itemIds);
        const allDeletedIds = new Set(result.deletedIds);

        // Move to trash
        const now = Date.now();
        const deletedItems = this.items
          .filter((i) => allDeletedIds.has(i.id))
          .map((i) => ({ ...i, deletedAt: now }));
        this.trashedItems.unshift(...deletedItems);

        // Remove from active
        this.items = this.items.filter((i) => !allDeletedIds.has(i.id));

        // Clear selection
        this.selectedItemIds.clear();

        return result;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.bulkOperationInProgress = false;
      }
    },

    // Bulk recover items from trash
    async bulkRecoverItems(sessionId, itemIds) {
      this.bulkOperationInProgress = true;
      this.error = null;
      try {
        const result = await api.bulkRecoverCanvasItems(sessionId, itemIds);
        const allRecoveredIds = new Set(result.recoveredIds);

        // Get the items from trash before removing
        const recoveredItems = this.trashedItems.filter((i) => allRecoveredIds.has(i.id));

        // Remove from trash
        this.trashedItems = this.trashedItems.filter((i) => !allRecoveredIds.has(i.id));

        // Add back to active items
        this.items.unshift(...recoveredItems);

        // Clear selection
        this.selectedItemIds.clear();

        return result;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.bulkOperationInProgress = false;
      }
    },

    // Bulk permanently delete items from trash
    async bulkPermanentlyDeleteItems(sessionId, itemIds) {
      this.bulkOperationInProgress = true;
      this.error = null;
      try {
        const result = await api.bulkPermanentlyDeleteCanvasItems(sessionId, itemIds);
        const allDeletedIds = new Set(result.deletedIds);

        // Remove from trash
        this.trashedItems = this.trashedItems.filter((i) => !allDeletedIds.has(i.id));

        // Clear selection
        this.selectedItemIds.clear();

        return result;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.bulkOperationInProgress = false;
      }
    },

    // --- Markdown editing actions ---

    /**
     * Update a canvas item's content in-place via PUT
     */
    async updateItemContent(sessionId, itemId, content) {
      try {
        const result = await api.updateCanvasItem(sessionId, itemId, { content });
        // Patch local item
        const item = this.items.find((i) => i.id === itemId);
        if (item) {
          item.content = result.content;
          item.updatedAt = result.updatedAt;
        }
        return result;
      } catch (err) {
        this.error = `Failed to update content: ${err.message}`;
        throw err;
      }
    },

    /**
     * Record that we're in an active editing session for this file
     */
    startEditing(filename, itemId) {
      this.editingSessionMap[filename] = itemId;
    },

    /**
     * Clear the editing session entry (called when navigating away).
     * Sets a flag so that saveMarkdownContent knows to create a new version
     * next time the user edits this file.
     */
    endEditing(filename) {
      delete this.editingSessionMap[filename];
      // Track that this file had an editing session that ended,
      // so the next edit creates a new version instead of in-place update.
      if (!this._hasEndedEditing) this._hasEndedEditing = {};
      this._hasEndedEditing[filename] = true;
    },

    /**
     * Main save logic for markdown content.
     * Always creates a new version for each edit to enable proper version tracking.
     *
     * @param {string} sessionId
     * @param {string} filename
     * @param {string} content
     * @param {string} [currentItemId] - The ID of the item currently being edited (unused but kept for API compatibility)
     */
    async saveMarkdownContent(sessionId, filename, content, currentItemId) {
      try {
        // Always create a new version for each edit
        const newItem = await api.createCanvasItem(sessionId, {
          type: 'markdown',
          content,
          filename,
        });
        this.addItem(newItem);
        this.startEditing(filename, newItem.id);
        return newItem;
      } catch (err) {
        this.error = `Failed to save markdown: ${err.message}`;
        // Don't throw — user should not lose work. Debounce will retry.
      }
    },

    /**
     * Patch an item in the local store (used by WebSocket handler)
     */
    patchItem(item) {
      const existing = this.items.find((i) => i.id === item.id);
      if (existing) {
        existing.content = item.content;
        existing.updatedAt = item.updatedAt;
      }
    },
  },
});
