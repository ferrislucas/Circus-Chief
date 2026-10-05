/**
 * Agents API resource mixin
 * Adds agent-capability methods to ApiClient.
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function AgentsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get the static capability map for every registered agent adapter.
     *
     * @returns {Promise<Array<{ agentType: string, capabilities: Object }>>}
     */
    async getAgents() {
      return this._get('/agents');
    },
  });
}
