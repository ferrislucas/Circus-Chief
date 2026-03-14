/**
 * Projects API resource mixin
 * Adds project-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function ProjectsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all projects
     * @returns {Promise<Array>}
     */
    async getProjects() {
      return this._get('/projects');
    },

    /**
     * Get a project by ID
     * @param {string} id - Project ID
     * @returns {Promise<Object>}
     */
    async getProject(id) {
      return this._get(`/projects/${id}`);
    },

    /**
     * Create a new project
     * @param {Object} data - Project data
     * @returns {Promise<Object>}
     */
    async createProject(data) {
      return this._post('/projects', data);
    },

    /**
     * Update a project
     * @param {string} id - Project ID
     * @param {Object} data - Updated project data
     * @returns {Promise<Object>}
     */
    async updateProject(id, data) {
      return this._put(`/projects/${id}`, data);
    },

    /**
     * Delete a project
     * @param {string} id - Project ID
     * @returns {Promise<void>}
     */
    async deleteProject(id) {
      return this._delete(`/projects/${id}`);
    },
  });
}
