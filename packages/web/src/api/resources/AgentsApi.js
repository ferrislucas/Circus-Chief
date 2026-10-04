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

    /**
     * Get the Muse agent shell parity diagnostics (FR-12): per-signal
     * pass/fail with remediation hints. Never carries secret values.
     *
     * @param {boolean} [reprobe=false] - Clear the server login-shell cache first.
     * @returns {Promise<{ probe: Object, signals: Array, env: Object }>}
     */
    async getMuseEnvDiagnostics(reprobe = false) {
      return this._get(`/agents/muse/env-diagnostics${reprobe ? '?reprobe=1' : ''}`);
    },
  });
}
