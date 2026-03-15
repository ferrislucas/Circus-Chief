/**
 * Canvas API resource mixin
 * Adds canvas-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function CanvasApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all canvas items for a session
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getCanvasItems(sessionId) {
      return this._get(`/sessions/${sessionId}/canvas`);
    },

    /**
     * Get canvas file content inline (content/data fields) for a single file
     * @param {string} sessionId - Session ID
     * @param {string} filename - Filename
     * @returns {Promise<{content: string|null, data: string|null, type: string, mimeType: string, filename: string}>}
     */
    async getCanvasFileContent(sessionId, filename) {
      return this._get(`/sessions/${sessionId}/canvas/file/${encodeURIComponent(filename)}/content`);
    },

    /**
     * Get all canvas items for a session (including all versions)
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getAllCanvasItems(sessionId) {
      return this._get(`/sessions/${sessionId}/canvas/all`);
    },

    /**
     * Upload a file to the canvas
     * @param {string} sessionId - Session ID
     * @param {File} file - File to upload
     * @returns {Promise<Object>}
     */
    async uploadCanvasItem(sessionId, file) {
      const formData = new FormData();
      formData.append('file', file);
      return this._uploadFormData(`/sessions/${sessionId}/canvas`, formData);
    },

    /**
     * Create a canvas item with text/markdown/json content
     * @param {string} sessionId - Session ID
     * @param {Object} data - Canvas item data
     * @param {string} data.type - Type: 'text', 'markdown', 'json', 'code'
     * @param {string} data.content - Text content
     * @param {string|null} data.filename - Optional filename
     * @returns {Promise<Object>}
     */
    async createCanvasItem(sessionId, data) {
      return this._post(`/sessions/${sessionId}/canvas`, data);
    },

    /**
     * Delete a canvas item (soft delete - move to trash)
     * @param {string} sessionId - Session ID
     * @param {string} itemId - Canvas item ID
     * @returns {Promise<Object>}
     */
    async deleteCanvasItem(sessionId, itemId) {
      return this._delete(`/sessions/${sessionId}/canvas/${itemId}`);
    },

    /**
     * Get trashed canvas items for a session
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getCanvasTrash(sessionId) {
      return this._get(`/sessions/${sessionId}/canvas-trash`);
    },

    /**
     * Recover a single canvas item from trash
     * @param {string} sessionId - Session ID
     * @param {string} itemId - Canvas item ID
     * @returns {Promise<Object>}
     */
    async recoverCanvasItem(sessionId, itemId) {
      return this._post(`/sessions/${sessionId}/canvas/${itemId}/recover`);
    },

    /**
     * Recover all versions of a file from trash
     * @param {string} sessionId - Session ID
     * @param {string} filename - Filename
     * @returns {Promise<Object>}
     */
    async recoverCanvasFile(sessionId, filename) {
      return this._post(`/sessions/${sessionId}/canvas-trash/recover-file/${encodeURIComponent(filename)}`);
    },

    /**
     * Permanently delete a canvas item from trash
     * @param {string} sessionId - Session ID
     * @param {string} itemId - Canvas item ID
     * @returns {Promise<void>}
     */
    async permanentlyDeleteCanvasItem(sessionId, itemId) {
      return this._delete(`/sessions/${sessionId}/canvas/${itemId}/permanent`);
    },

    /**
     * Soft delete multiple canvas items (move to trash)
     * @param {string} sessionId - Session ID
     * @param {string[]} itemIds - Array of canvas item IDs
     * @returns {Promise<Object>} - { deletedCount: number }
     */
    async bulkDeleteCanvasItems(sessionId, itemIds) {
      return this._post(`/sessions/${sessionId}/canvas/bulk-delete`, { itemIds });
    },

    /**
     * Recover multiple canvas items from trash
     * @param {string} sessionId - Session ID
     * @param {string[]} itemIds - Array of canvas item IDs
     * @returns {Promise<Object>} - { recoveredCount: number }
     */
    async bulkRecoverCanvasItems(sessionId, itemIds) {
      return this._post(`/sessions/${sessionId}/canvas/bulk-recover`, { itemIds });
    },

    /**
     * Permanently delete multiple canvas items from trash
     * @param {string} sessionId - Session ID
     * @param {string[]} itemIds - Array of canvas item IDs
     * @returns {Promise<Object>} - { deletedCount: number }
     */
    async bulkPermanentlyDeleteCanvasItems(sessionId, itemIds) {
      return this._delete(`/sessions/${sessionId}/canvas/bulk-delete-permanent`, { itemIds });
    },
  });
}
