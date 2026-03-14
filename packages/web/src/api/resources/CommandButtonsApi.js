/**
 * Command Buttons API resource mixin
 * Adds command button-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function CommandButtonsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all command buttons for a project
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>}
     */
    async getCommandButtons(projectId) {
      return this._get(`/projects/${projectId}/command-buttons`);
    },

    /**
     * Create a new command button
     * @param {string} projectId - Project ID
     * @param {Object} data - Button data
     * @returns {Promise<Object>}
     */
    async createCommandButton(projectId, data) {
      return this._post(`/projects/${projectId}/command-buttons`, data);
    },

    /**
     * Get a specific command button
     * @param {string} projectId - Project ID
     * @param {string} buttonId - Button ID
     * @returns {Promise<Object>}
     */
    async getCommandButton(projectId, buttonId) {
      return this._get(`/projects/${projectId}/command-buttons/${buttonId}`);
    },

    /**
     * Update a command button
     * @param {string} projectId - Project ID
     * @param {string} buttonId - Button ID
     * @param {Object} data - Update data
     * @returns {Promise<Object>}
     */
    async updateCommandButton(projectId, buttonId, data) {
      return this._patch(`/projects/${projectId}/command-buttons/${buttonId}`, data);
    },

    /**
     * Delete a command button
     * @param {string} projectId - Project ID
     * @param {string} buttonId - Button ID
     * @returns {Promise<void>}
     */
    async deleteCommandButton(projectId, buttonId) {
      return this._delete(`/projects/${projectId}/command-buttons/${buttonId}`);
    },

    /**
     * Run a command button
     * @param {string} sessionId - Session ID
     * @param {string} buttonId - Button ID
     * @returns {Promise<Object>}
     */
    async runCommandButton(sessionId, buttonId) {
      return this._post(`/sessions/${sessionId}/command-buttons/${buttonId}/run`);
    },

    /**
     * Get active command runs for a session (both running and recently completed)
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getActiveRuns(sessionId) {
      return this._get(`/sessions/${sessionId}/command-buttons/runs`);
    },

    /**
     * Get a single command run by ID
     * @param {string} sessionId - Session ID
     * @param {string} runId - Run ID
     * @returns {Promise<Object>}
     */
    async getCommandRun(sessionId, runId) {
      return this._get(`/sessions/${sessionId}/command-buttons/runs/${runId}`);
    },

    /**
     * Get the latest run for each button per session within a project
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>}
     */
    async getLatestRunsForProject(projectId) {
      return this._get(`/projects/${projectId}/command-buttons/latest-runs`);
    },

    /**
     * Kill a running command
     * @param {string} sessionId - Session ID
     * @param {string} runId - Run ID
     * @returns {Promise<Object>}
     */
    async killCommandRun(sessionId, runId) {
      return this._post(`/sessions/${sessionId}/command-buttons/runs/${runId}/kill`);
    },
  });
}
