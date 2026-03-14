/**
 * Quick Responses API resource mixin
 * Adds quick response-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function QuickResponsesApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get quick responses for a project (includes both project-specific and global)
     * @param {string} projectId - Project ID
     * @returns {Promise<{project: Array, global: Array}>}
     */
    async getQuickResponses(projectId) {
      return this._get(`/projects/${projectId}/quick-responses`);
    },

    /**
     * Get global quick responses only
     * @returns {Promise<Array>}
     */
    async getGlobalQuickResponses() {
      return this._get('/quick-responses/global');
    },

    /**
     * Create a quick response
     * @param {string} projectId - Project ID
     * @param {Object} data - Quick response data
     * @returns {Promise<Object>}
     */
    async createQuickResponse(projectId, data) {
      return this._post(`/projects/${projectId}/quick-responses`, data);
    },

    /**
     * Update a quick response
     * @param {string} id - Quick response ID
     * @param {Object} data - Update data
     * @returns {Promise<Object>}
     */
    async updateQuickResponse(id, data) {
      return this._patch(`/quick-responses/${id}`, data);
    },

    /**
     * Delete a quick response
     * @param {string} id - Quick response ID
     * @returns {Promise<void>}
     */
    async deleteQuickResponse(id) {
      return this._delete(`/quick-responses/${id}`);
    },

    /**
     * Reorder quick responses for a project
     * @param {string} projectId - Project ID
     * @param {Array<{id: string, sortOrder: number}>} orders - Array of id/sortOrder pairs
     * @returns {Promise<{project: Array, global: Array}>}
     */
    async reorderQuickResponses(projectId, orders) {
      return this._post(`/projects/${projectId}/quick-responses/reorder`, orders);
    },

    /**
     * Reorder global quick responses
     * @param {Array<{id: string, sortOrder: number}>} orders - Array of id/sortOrder pairs
     * @returns {Promise<Array>}
     */
    async reorderGlobalQuickResponses(orders) {
      return this._post('/quick-responses/global/reorder', orders);
    },
  });
}
