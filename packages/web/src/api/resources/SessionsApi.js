/**
 * Append defined values from jsonData to formData for the given field names.
 * @param {FormData} formData
 * @param {Object} jsonData
 * @param {string[]} fields
 */
function appendOptionalFields(formData, jsonData, fields) {
  for (const field of fields) {
    if (jsonData[field] !== undefined && jsonData[field] !== null) {
      formData.append(field, jsonData[field]);
    }
  }
}

/**
 * Append defined boolean values from jsonData (as strings) for the given field names.
 * @param {FormData} formData
 * @param {Object} jsonData
 * @param {string[]} fields
 */
function appendBooleanFields(formData, jsonData, fields) {
  for (const field of fields) {
    if (jsonData[field] !== undefined && jsonData[field] !== null) formData.append(field, String(jsonData[field]));
  }
}

/**
 * Build a FormData payload for session creation with file uploads.
 * @param {Object} jsonData - JSON session data
 * @param {File[]} files - Files to attach
 * @returns {FormData}
 */
function buildSessionFormData(jsonData, files) {
  const formData = new FormData();
  formData.append('prompt', jsonData.prompt);

  appendOptionalFields(formData, jsonData, [
    'name', 'mode', 'model', 'effortLevel', 'gitBranch', 'gitMode',
    'templateId', 'parentSessionId',
  ]);

  appendBooleanFields(formData, jsonData, [
    'thinkingEnabled', 'startImmediately',
    'autoRescheduleEnabled', 'rescheduleOnTokenLimit', 'rescheduleOnServiceError',
  ]);

  appendOptionalFields(formData, jsonData, [
    'scheduledAt', 'rescheduleDelayMinutes', 'maxRescheduleCount',
    'maxTotalTokens', 'rescheduleAtTokenCount',
  ]);

  for (const file of files) {
    formData.append('files', file);
  }

  return formData;
}

/**
 * Sessions API resource mixin
 * Adds session-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function SessionsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all active/waiting sessions across all projects
     * @returns {Promise<Array>}
     */
    async getActiveSessions() {
      return this._get('/sessions');
    },

    /**
     * Get all scheduled sessions (optionally filtered by project)
     * @param {string|null} projectId - Optional project ID to filter by
     * @returns {Promise<Array>}
     */
    async getScheduledSessions(projectId = null) {
      return this._get(this._buildQueryPath('/sessions/scheduled', {
        projectId: projectId || undefined,
      }));
    },

    /**
     * Get all sessions for a project
     * @param {string} projectId - Project ID
     * @param {boolean|null} archived - Filter by archived status (null = all, true = archived only, false = non-archived only)
     * @param {string|null} starred - Filter by starred status (null = all, 'starred' = starred only, 'unstarred' = unstarred only)
     * @param {Object} paginationOptions - Pagination options
     * @param {number|null} paginationOptions.limit - Number of sessions to fetch (null = all)
     * @param {number} paginationOptions.offset - Offset for pagination (default: 0)
     * @returns {Promise<Array|{sessions: Array, pagination: Object}>} Array when no pagination, object with pagination metadata when limit is specified
     */
    async getProjectSessions(projectId, archived = null, starred = null, { limit = null, offset = 0 } = {}) {
      const params = {};
      if (archived !== null) {
        params.archived = archived;
      }
      if (starred === 'starred') {
        params.starred = true;
      } else if (starred === 'unstarred') {
        params.starred = false;
      }
      if (limit !== null) {
        params.limit = limit;
        params.offset = offset;
      }
      return this._get(this._buildQueryPath(`/projects/${projectId}/sessions`, params));
    },

    /**
     * Create a new session
     * @param {string} projectId - Project ID
     * @param {Object} data - Session data (may include files array and startImmediately flag)
     * @returns {Promise<Object>}
     */
    async createSession(projectId, data) {
      const { files, ...jsonData } = data;

      // Use FormData if files are attached, otherwise JSON
      if (files && files.length > 0) {
        const formData = buildSessionFormData(jsonData, files);
        return this._uploadFormData(`/projects/${projectId}/sessions`, formData);
      }

      return this._post(`/projects/${projectId}/sessions`, jsonData);
    },

    /**
     * Get a session by ID
     * @param {string} id - Session ID
     * @returns {Promise<Object>}
     */
    async getSession(id) {
      return this._get(`/sessions/${id}`);
    },

    /**
     * Get all messages for a session
     * @param {string} id - Session ID
     * @returns {Promise<Array>}
     */
    async getSessionMessages(id) {
      return this._get(`/sessions/${id}/messages`);
    },

    /**
     * Get work logs for a session (grouped by message ID)
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>} Work logs grouped by message ID
     */
    async getSessionWorkLogs(sessionId) {
      return this._get(`/sessions/${sessionId}/work-logs`);
    },

    /**
     * Send a message to a session
     * @param {string} sessionId - Session ID
     * @param {string} content - Message content
     * @param {Array} files - Optional array of files to attach
     * @param {string|null} model - Model to use for this message
     * @returns {Promise<Object>}
     */
    async sendMessage(sessionId, content, files = [], model = null) {
      // [MODEL AUDIT] Log model in API request
      console.log(`[MODEL AUDIT - ApiClient] sendMessage called with model: "${model}"`);

      // Use FormData if files are attached, otherwise JSON
      if (files && files.length > 0) {
        const formData = new FormData();
        formData.append('content', content);
        if (model) {
          formData.append('model', model);
        }

        for (const file of files) {
          formData.append('files', file);
        }

        return this._uploadFormData(`/sessions/${sessionId}/message`, formData);
      }

      return this._post(`/sessions/${sessionId}/message`, { content, model });
    },

    /**
     * Stop a session
     * @param {string} id - Session ID
     * @returns {Promise<Object>}
     */
    async stopSession(id) {
      return this._post(`/sessions/${id}/stop`);
    },

    /**
     * Get git changes for a session
     * @param {string} sessionId - Session ID
     * @param {string} compareMode - 'local' (default) or 'branch'
     * @param {string|null} branch - Branch to compare against (only used if compareMode is 'branch')
     * @returns {Promise<{staged: string, unstaged: string, untracked: string}>}
     */
    async getSessionChanges(sessionId, compareMode = 'local', branch = null) {
      const params = {};
      if (compareMode === 'branch') {
        params.compareMode = 'branch';
        if (branch) {
          params.branch = branch;
        }
      }
      return this._get(this._buildQueryPath(`/sessions/${sessionId}/changes`, params));
    },

    /**
     * Get the default branch for a session (for branch comparison)
     * @param {string} sessionId
     * @returns {Promise<{branch: string}>}
     */
    async getSessionDefaultBranch(sessionId) {
      return this._get(`/sessions/${sessionId}/default-branch`);
    },

    /**
     * Get count of files modified compared to the default branch
     * @param {string} sessionId - Session ID
     * @returns {Promise<{count: number}>}
     */
    async getSessionFilesCount(sessionId) {
      return this._get(`/sessions/${sessionId}/files-count`);
    },

    /**
     * Get a file from the session's working directory (for displaying images in diffs)
     * @param {string} sessionId - Session ID
     * @param {string} filePath - Relative path to file
     * @returns {Promise<{data: string, mimeType: string, filename: string}>}
     */
    async getSessionFile(sessionId, filePath) {
      return this._get(`/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`);
    },

    /**
     * Restart a completed or errored session
     * @param {string} id - Session ID
     * @returns {Promise<Object>}
     */
    async restartSession(id) {
      return this._post(`/sessions/${id}/restart`);
    },

    /**
     * Start a draft session (waiting status with no assistant messages)
     * @param {string} id - Session ID
     * @param {string|undefined} prompt - Optional updated prompt to use when starting
     * @param {string|undefined} model - Optional model override
     * @returns {Promise<Object>}
     */
    async startSession(id, prompt, model) {
      const data = {};
      if (prompt !== undefined) data.prompt = prompt;
      if (model !== undefined) data.model = model;
      return this._post(`/sessions/${id}/start`,
        Object.keys(data).length > 0 ? data : undefined);
    },

    /**
     * Update the initial prompt for a draft session
     * @param {string} id - Session ID
     * @param {string} prompt - The new prompt
     * @returns {Promise<Object>}
     */
    async updateSessionInitialPrompt(id, prompt) {
      return this._put(`/sessions/${id}/initial-prompt`, { prompt });
    },

    /**
     * Update session settings
     * @param {string} id - Session ID
     * @param {Object} data - Update data (e.g., { thinkingEnabled: true })
     * @returns {Promise<Object>}
     */
    async updateSession(id, data) {
      return this._patch(`/sessions/${id}`, data);
    },

    /**
     * Update the pending prompt for a session (auto-save input field)
     * @param {string} id - Session ID
     * @param {string|null} pendingPrompt - The pending prompt (or null to clear)
     * @returns {Promise<Object>}
     */
    async updateSessionPendingPrompt(id, pendingPrompt) {
      return this._patch(`/sessions/${id}/pending-prompt`, { pendingPrompt });
    },

    /**
     * Delete a session
     * @param {string} id - Session ID
     * @returns {Promise<void>}
     */
    async deleteSession(id) {
      return this._delete(`/sessions/${id}`);
    },

    /**
     * Archive a session
     * @param {string} id - Session ID
     * @param {Object} [options] - Archive options
     * @param {boolean} [options.cleanup=false] - Whether to clean up git worktree
     * @returns {Promise<Object>}
     */
    async archiveSession(id, { cleanup = false } = {}) {
      return this._post(`/sessions/${id}/archive`, { cleanup });
    },

    /**
     * Unarchive a session
     * @param {string} id - Session ID
     * @returns {Promise<Object>}
     */
    async unarchiveSession(id) {
      return this._post(`/sessions/${id}/unarchive`);
    },

    /**
     * Toggle star status for a session
     * @param {string} id - Session ID
     * @returns {Promise<Object>}
     */
    async toggleSessionStar(id) {
      return this._post(`/sessions/${id}/star`);
    },

    /**
     * Duplicate a session (clone with all data)
     * @param {string} id - Session ID to duplicate
     * @param {Object} options - Duplication options
     * @param {string} [options.name] - Custom name for duplicated session
     * @param {string} [options.gitMode] - Git mode (none|branch|worktree)
     * @param {string} [options.gitBranch] - Git branch name (if gitMode is branch)
     * @returns {Promise<Object>}
     */
    async duplicateSession(id, options = {}) {
      return this._post(`/sessions/${id}/duplicate`, options);
    },

    /**
     * Schedule a follow-up for an existing session
     * @param {string} id - Session ID
     * @param {Object} data - Scheduling data
     * @returns {Promise<Object>}
     */
    async scheduleSession(id, data) {
      return this._post(`/sessions/${id}/schedule`, data);
    },
  });
}
