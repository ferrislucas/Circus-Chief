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

    /** Fetch the bounded workspace-card read model used by the list view. */
    async getWorkspaceCards(projectId, options = {}) {
      const { limit = 50, cursor = null, archived = false, starred = null, status = null, scheduled = null, signal } = options;
      const params = { view: 'cards', limit, cursor, archived };
      if (starred !== null) params.starred = starred;
      if (status) params.status = status;
      if (scheduled !== null) params.scheduled = scheduled;
      return this._get(this._buildQueryPath(`/projects/${projectId}/workspaces`, params), { signal });
    },

    async getWorkspaceDetail(workspaceId) {
      return this._get(`/workspaces/${workspaceId}`);
    },

    async getWorkspaceMembers(workspaceId) {
      return this._get(`/workspaces/${workspaceId}/members`);
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
