/**
 * Miscellaneous API resource mixin
 * Adds git, todos, summaries, notes, filesystem, slash commands,
 * agent logs, and session defaults methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function MiscApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    // Git

    /**
     * Get git status for a project
     * @param {string} projectId - Project ID
     * @returns {Promise<Object>}
     */
    async getGitStatus(projectId) {
      return this._get(`/git/projects/${projectId}/status`);
    },

    /**
     * Get worktrees for a project
     * @param {string} projectId - Project ID
     * @returns {Promise<Array>}
     */
    async getWorktrees(projectId) {
      return this._get(`/git/projects/${projectId}/worktrees`);
    },

    // Todos

    /**
     * Get all todos for a session (or specific conversation)
     * @param {string} sessionId - Session ID
     * @param {string} [conversationId] - Optional conversation ID to fetch todos for
     * @returns {Promise<Array>}
     */
    async getSessionTodos(sessionId, conversationId = null) {
      return this._get(this._buildQueryPath(`/sessions/${sessionId}/todos`, {
        conversation_id: conversationId || undefined,
      }));
    },

    // Summaries

    /**
     * Get session summary
     * @param {string} sessionId - Session ID
     * @param {boolean} generateIfMissing - Generate summary if not found
     * @returns {Promise<Object|null>}
     */
    async getSessionSummary(sessionId, generateIfMissing = false) {
      const path = generateIfMissing
        ? this._buildQueryPath(`/sessions/${sessionId}/summary`, { generate: 'true' })
        : `/sessions/${sessionId}/summary`;
      try {
        return await this._get(path);
      } catch (err) {
        // Return null instead of throwing for 404 (no summary yet)
        if (err.message.includes('404') || err.message.includes('not found')) {
          return null;
        }
        throw err;
      }
    },

    /**
     * Get summaries for multiple sessions in a single batch request
     * @param {string[]} ids - Array of session IDs
     * @returns {Promise<Object>} Map of sessionId -> summary (or null)
     */
    async getSessionSummariesBatch(ids) {
      if (!ids || ids.length === 0) return {};
      return this._post('/sessions/summaries/batch', { ids });
    },

    /**
     * Generate/regenerate session summary
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>}
     */
    async generateSessionSummary(sessionId) {
      return this._post(`/sessions/${sessionId}/summary`);
    },

    /**
     * Get the most recent assistant response across the entire workflow
     * @param {string} sessionId - Any session ID in the workflow
     * @returns {Promise<{message: Object, sessionName: string}|null>}
     */
    async getWorkflowLatestResponse(sessionId) {
      try {
        return await this._get(`/sessions/${sessionId}/workflow-latest-response`);
      } catch (err) {
        if (err.message.includes('404')) {
          return null;
        }
        throw err;
      }
    },

    // Notes

    /**
     * Get all notes for a session
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getSessionNotes(sessionId) {
      return this._get(`/sessions/${sessionId}/notes`);
    },

    /**
     * Create a note for a session
     * @param {string} sessionId - Session ID
     * @param {string} content - Note content
     * @returns {Promise<Object>}
     */
    async createNote(sessionId, content) {
      return this._post(`/sessions/${sessionId}/notes`, { content });
    },

    /**
     * Update a note
     * @param {string} sessionId - Session ID
     * @param {string} noteId - Note ID
     * @param {string} content - Updated note content
     * @returns {Promise<Object>}
     */
    async updateNote(sessionId, noteId, content) {
      return this._put(`/sessions/${sessionId}/notes/${noteId}`, { content });
    },

    /**
     * Delete a note
     * @param {string} sessionId - Session ID
     * @param {string} noteId - Note ID
     * @returns {Promise<void>}
     */
    async deleteNote(sessionId, noteId) {
      return this._delete(`/sessions/${sessionId}/notes/${noteId}`);
    },

    // Filesystem

    /**
     * Browse a directory
     * @param {string} path - Directory path to browse (defaults to home directory if empty)
     * @returns {Promise<{path: string, parent: string|null, entries: Array<{name: string, type: string}>, error: string|null}>}
     */
    async browseDirectory(path = '') {
      return this._get(this._buildQueryPath('/filesystem/browse', {
        path: path || undefined,
      }));
    },

    // Slash Commands

    /**
     * Get all available slash commands for a directory
     * @param {string} directory - Working directory to discover commands from
     * @returns {Promise<Array>} Array of command objects
     */
    async getSlashCommands(directory) {
      return this._get(`/commands?directory=${encodeURIComponent(directory)}`);
    },

    /**
     * Get a single slash command by name
     * @param {string} directory - Working directory to discover commands from
     * @param {string} name - Command name
     * @returns {Promise<Object>} Command object
     */
    async getSlashCommand(directory, name) {
      return this._get(`/commands/${encodeURIComponent(name)}?directory=${encodeURIComponent(directory)}`);
    },

    /**
     * Execute a slash command in a session
     * @param {string} sessionId - Session to execute command in
     * @param {string} name - Command name
     * @param {Object} args - Argument values keyed by argument name
     * @returns {Promise<Object>} Execution result
     */
    async executeSlashCommand(sessionId, name, args = {}) {
      return this._post(`/commands/${encodeURIComponent(name)}/execute`, {
        sessionId,
        args,
      });
    },

    // Agent Call Logs

    /**
     * Get paginated agent call logs with optional filters
     * @param {Object} options - Filter/sort/pagination options
     * @returns {Promise<{logs: Array, pagination: Object}>}
     */
    async getAgentCallLogs({
      limit,
      offset,
      agentType,
      callType,
      status,
      startDate,
      endDate,
      sessionId,
      model,
      sortBy,
      sortOrder,
    } = {}) {
      const params = {};
      if (limit != null) params.limit = limit;
      if (offset != null) params.offset = offset;
      if (agentType) params.agentType = agentType;
      if (callType) params.callType = callType;
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (sessionId) params.sessionId = sessionId;
      if (model) params.model = model;
      if (sortBy) params.sortBy = sortBy;
      if (sortOrder) params.sortOrder = sortOrder;
      return this._get(this._buildQueryPath('/agent-calls', params));
    },

    /**
     * Get distinct filter option values for agent call log dropdowns
     * @returns {Promise<{agentTypes: string[], callTypes: string[], statuses: string[], models: string[]}>}
     */
    async getAgentCallFilterOptions() {
      return this._get('/agent-calls/filter-options');
    },

    /**
     * Delete all agent call logs
     * @returns {Promise<{success: boolean, deleted: number}>}
     */
    async deleteAllAgentCallLogs() {
      return this._delete('/agent-calls');
    },

    // Project Session Defaults

    /**
     * Get session defaults for a project
     * @param {string} projectId - Project ID
     * @returns {Promise<Object|null>}
     */
    async getProjectSessionDefaults(projectId) {
      return this._get(`/projects/${projectId}/session-defaults`);
    },

    /**
     * Update/create session defaults for a project
     * @param {string} projectId - Project ID
     * @param {Object} data - Defaults data
     * @returns {Promise<Object>}
     */
    async updateProjectSessionDefaults(projectId, data) {
      return this._post(`/projects/${projectId}/session-defaults`, data);
    },

    /**
     * Reset session defaults for a project to system defaults
     * @param {string} projectId - Project ID
     * @returns {Promise<Object>}
     */
    async resetProjectSessionDefaults(projectId) {
      return this._delete(`/projects/${projectId}/session-defaults`);
    },
  });
}
