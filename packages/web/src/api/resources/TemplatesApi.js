/**
 * Templates API resource mixin
 * Adds template-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function TemplatesApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all global templates
     * @returns {Promise<Array>}
     */
    async getGlobalTemplates() {
      return this._get('/templates');
    },

    /**
     * Create a global template
     * @param {Object} data - Template data
     * @returns {Promise<Object>}
     */
    async createGlobalTemplate(data) {
      return this._post('/templates', data);
    },

    /**
     * Get a template by ID
     * @param {string} id - Template ID
     * @returns {Promise<Object>}
     */
    async getTemplate(id) {
      return this._get(`/templates/${id}`);
    },

    /**
     * Update a template
     * @param {string} id - Template ID
     * @param {Object} data - Updated template data
     * @returns {Promise<Object>}
     */
    async updateTemplate(id, data) {
      return this._patch(`/templates/${id}`, data);
    },

    /**
     * Delete a template
     * @param {string} id - Template ID
     * @returns {Promise<void>}
     */
    async deleteTemplate(id) {
      return this._delete(`/templates/${id}`);
    },

    /**
     * Get templates for a project (includes both project and global templates)
     * @param {string} projectId - Project ID
     * @returns {Promise<{project: Array, global: Array}>}
     */
    async getProjectTemplates(projectId) {
      return this._get(`/projects/${projectId}/templates`);
    },

    /**
     * Create a project template
     * @param {string} projectId - Project ID
     * @param {Object} data - Template data
     * @returns {Promise<Object>}
     */
    async createProjectTemplate(projectId, data) {
      return this._post(`/projects/${projectId}/templates`, data);
    },
  });
}
