/**
 * Settings API resource mixin
 * Adds settings-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function SettingsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get token cost weights
     * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
     */
    async getTokenCostWeights() {
      return this._get('/settings/token-weights');
    },

    /**
     * Update token cost weights
     * @param {Object} weights - Token cost weights
     * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
     */
    async updateTokenCostWeights(weights) {
      return this._put('/settings/token-weights', weights);
    },

    /**
     * Reset token cost weights to defaults
     * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
     */
    async resetTokenCostWeights() {
      return this._delete('/settings/token-weights');
    },

    /**
     * Get summary settings
     * @returns {Promise<{disableSessionSummaries: boolean, disableConversationSummaries: boolean, sessionTitlePrompt: string}>}
     */
    async getSummarySettings() {
      return this._get('/settings/summary');
    },

    /**
     * Update summary settings
     * @param {Object} settings - Summary settings
     * @returns {Promise<{disableSessionSummaries: boolean, disableConversationSummaries: boolean, sessionTitlePrompt: string}>}
     */
    async updateSummarySettings(settings) {
      return this._put('/settings/summary', settings);
    },

    /**
     * Reset summary settings to defaults
     * @returns {Promise<{disableSessionSummaries: boolean, disableConversationSummaries: boolean, sessionTitlePrompt: string}>}
     */
    async resetSummarySettings() {
      return this._delete('/settings/summary');
    },

    /**
     * Get general settings
     * @returns {Promise<{disableAnalytics: boolean}>}
     */
    async getGeneralSettings() {
      return this._get('/settings/general');
    },

    /**
     * Update general settings
     * @param {Object} settings - General settings
     * @returns {Promise<{disableAnalytics: boolean}>}
     */
    async updateGeneralSettings(settings) {
      return this._put('/settings/general', settings);
    },

    /**
     * Reset general settings to defaults
     * @returns {Promise<{disableAnalytics: boolean}>}
     */
    async resetGeneralSettings() {
      return this._delete('/settings/general');
    },
  });
}
