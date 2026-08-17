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

    /** Fetch one cursor (or legacy offset) page of the workspace-card read model. */
    async getWorkspaceCards(projectId, options = {}) {
      const {
        limit = 50,
        offset = 0,
        cursor = null,
        archived = false,
        starred = null,
        status = null,
        scheduled = null,
        signal,
      } = options;
      const params = { view: 'cards', limit, offset, archived };
      if (cursor) params.cursor = cursor;
      if (starred !== null) params.starred = starred;
      if (status) params.status = status;
      if (scheduled !== null) params.scheduled = scheduled;
      return this._get(this._buildQueryPath(`/projects/${projectId}/workspaces`, params), { signal });
    },

    /** Fetch the bounded, complete workspace set used by selection dialogs. */
    async getWorkspaceCardsForPicker(projectId, { max = 1_000, signal } = {}) {
      const workspaces = [];
      let cursor = null;
      let pagination = {};
      do {
        const result = await this.getWorkspaceCards(projectId, {
          limit: Math.min(500, max - workspaces.length), cursor, signal,
        });
        workspaces.push(...(result.workspaces || []));
        pagination = result.pagination || {};
        cursor = pagination.nextCursor || null;
      } while (cursor && workspaces.length < max);
      return { workspaces, pagination: { ...pagination, truncated: Boolean(cursor) } };
    },

    async getWorkspaceDetail(workspaceId, { signal } = {}) {
      return this._get(`/workspaces/${workspaceId}`, { signal });
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
