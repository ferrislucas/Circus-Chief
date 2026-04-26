import { api } from '../composables/useApi.js';

export const canvasActions = {
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

  async fetchItemContent(sessionId, filename, itemId = null) {
    // Check if already fetched (cache hit).
    // Use === undefined (NOT falsy check) because:
    //   - null is a valid fetched value (e.g., content is null for image items)
    //   - '' is a valid fetched value (empty text files)
    //   - undefined means the field was stripped by the list endpoint (not yet fetched)
    const existing = itemId
      ? this.items.find(i => i.id === itemId)
      : this.items.find(i => i.filename === filename);
    if (existing && (existing.content !== undefined || existing.data !== undefined)) {
      return { content: existing.content, data: existing.data };
    }

    const result = itemId
      ? await api.getCanvasItemContent(sessionId, itemId)
      : await api.getCanvasFileContent(sessionId, filename);
    const item = itemId
      ? this.items.find(i => i.id === itemId)
      : this.items.find(i => i.filename === filename);
    if (item) {
      item.content = result.content;
      item.data = result.data;
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
      this.addItem(item);
      return item;
    } catch (err) {
      this.error = err.message;
      throw err;
    } finally {
      this.loading = false;
    }
  },

  /**
   * Add an item to the store, or merge fields into an existing entry with the
   * same id. Idempotent so that both the post-response cache update and the
   * WebSocket CANVAS_ADD echo can safely call this without duplicating items.
   *
   * Merge semantics (defensive against partial payloads):
   *   - Keys whose incoming value is `undefined` are skipped entirely.
   *   - For `content` / `data` specifically, a `null` on the incoming payload
   *     does NOT overwrite a populated (`!= null`) cached value. This prevents
   *     a future metadata-only broadcast from blanking out a lazily-fetched
   *     body. A `null` IS applied when the existing value is already null/
   *     undefined (so the field is still populated as known-empty).
   *   - All other keys overwrite normally, including meaningful falsy values
   *     (`0`, `''`, `false`).
   */
  addItem(item) {
    if (!item || !item.id) return;
    const existing = this.items.find((i) => i.id === item.id);
    if (!existing) {
      this.items.unshift(item);
      return;
    }
    for (const [k, v] of Object.entries(item)) {
      if (v === undefined) continue;
      if ((k === 'content' || k === 'data') && v === null && existing[k] != null) continue;
      existing[k] = v;
    }
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
      this.addItem(item);
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

      // Add back to active items via addItem so WS echoes don't duplicate them
      recoveredItems.forEach((i) => this.addItem(i));

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
};
