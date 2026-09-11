/**
 * Model Tiers API resource mixin
 * Adds tier-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function TiersApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all model tiers (with members)
     * @returns {Promise<Array>}
     */
    async getTiers() {
      return this._get('/tiers');
    },

    /**
     * Get a single tier by ID
     * @param {string} id
     * @returns {Promise<Object>}
     */
    async getTier(id) {
      return this._get(`/tiers/${id}`);
    },

    /**
     * Create a new model tier
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    async createTier(data) {
      return this._post('/tiers', data);
    },

    /**
     * Update a model tier
     * @param {string} id
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    async updateTier(id, data) {
      return this._patch(`/tiers/${id}`, data);
    },

    /**
     * Delete a model tier
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteTier(id) {
      return this._delete(`/tiers/${id}`);
    },
  });
}
