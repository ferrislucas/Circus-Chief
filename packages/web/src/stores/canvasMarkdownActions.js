import { api } from '../composables/useApi.js';

export const canvasMarkdownActions = {
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
};
