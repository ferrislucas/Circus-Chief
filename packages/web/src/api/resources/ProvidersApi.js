/**
 * Providers API resource mixin
 * Adds model provider-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function ProvidersApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all model providers
     * @returns {Promise<Array>}
     */
    async getProviders() {
      return this._get('/providers');
    },

    /**
     * Get a provider by ID
     * @param {string} id - Provider ID
     * @returns {Promise<Object>}
     */
    async getProvider(id) {
      return this._get(`/providers/${id}`);
    },

    /**
     * Create a new provider
     * @param {Object} data - Provider data
     * @returns {Promise<Object>}
     */
    async createProvider(data) {
      return this._post('/providers', data);
    },

    /**
     * Update a provider
     * @param {string} id - Provider ID
     * @param {Object} data - Updated provider data
     * @returns {Promise<Object>}
     */
    async updateProvider(id, data) {
      return this._patch(`/providers/${id}`, data);
    },

    /**
     * Delete a provider
     * @param {string} id - Provider ID
     * @returns {Promise<void>}
     */
    async deleteProvider(id) {
      return this._delete(`/providers/${id}`);
    },

    /**
     * Test a provider configuration
     * @param {Object} config - Provider configuration to test
     * @returns {Promise<{success: boolean, message: string, details?: Object}>}
     */
    async testProviderConnection(config) {
      return this._post('/providers/test', config);
    },

    /**
     * Test an existing provider
     * @param {string} id - Provider ID
     * @returns {Promise<{success: boolean, message: string, details?: Object}>}
     */
    async testExistingProvider(id) {
      return this._post(`/providers/${id}/test`);
    },

    /**
     * Get models for a provider
     * @param {string} providerId - Provider ID
     * @returns {Promise<Array>}
     */
    async getProviderModels(providerId) {
      return this._get(`/providers/${providerId}/models`);
    },

    /**
     * Add a model to a provider
     * @param {string} providerId - Provider ID
     * @param {Object} data - Model data
     * @returns {Promise<Object>}
     */
    async addProviderModel(providerId, data) {
      return this._post(`/providers/${providerId}/models`, data);
    },

    /**
     * Update a model
     * @param {string} providerId - Provider ID
     * @param {string} modelId - Model ID (row ID)
     * @param {Object} data - Updated model data
     * @returns {Promise<Object>}
     */
    async updateProviderModel(providerId, modelId, data) {
      return this._patch(`/providers/${providerId}/models/${modelId}`, data);
    },

    /**
     * Remove a model from a provider
     * @param {string} providerId - Provider ID
     * @param {string} modelId - Model ID
     * @returns {Promise<void>}
     */
    async removeProviderModel(providerId, modelId) {
      return this._delete(`/providers/${providerId}/models/${modelId}`);
    },
  });
}
