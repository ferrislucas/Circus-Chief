/**
 * API client class for making HTTP requests to the backend
 */
export class ApiClient {
  #baseUrl;

  /**
   * Create a new API client
   * @param {string} baseUrl - Base URL for API requests
   */
  constructor(baseUrl = '/api') {
    this.#baseUrl = baseUrl;
  }

  /**
   * Get the base URL
   * @returns {string}
   */
  get baseUrl() {
    return this.#baseUrl;
  }

  /**
   * Make an HTTP request
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} data - Request body data
   * @returns {Promise<any>}
   */
  async #request(method, path, data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.#baseUrl}${path}`, options);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  // Projects

  /**
   * Get all projects
   * @returns {Promise<Array>}
   */
  async getProjects() {
    return this.#request('GET', '/projects');
  }

  /**
   * Get a project by ID
   * @param {string} id - Project ID
   * @returns {Promise<Object>}
   */
  async getProject(id) {
    return this.#request('GET', `/projects/${id}`);
  }

  /**
   * Create a new project
   * @param {Object} data - Project data
   * @returns {Promise<Object>}
   */
  async createProject(data) {
    return this.#request('POST', '/projects', data);
  }

  /**
   * Update a project
   * @param {string} id - Project ID
   * @param {Object} data - Updated project data
   * @returns {Promise<Object>}
   */
  async updateProject(id, data) {
    return this.#request('PUT', `/projects/${id}`, data);
  }

  /**
   * Delete a project
   * @param {string} id - Project ID
   * @returns {Promise<void>}
   */
  async deleteProject(id) {
    return this.#request('DELETE', `/projects/${id}`);
  }

  // Sessions

  /**
   * Get all active/waiting sessions across all projects
   * @returns {Promise<Array>}
   */
  async getActiveSessions() {
    return this.#request('GET', '/sessions');
  }

  /**
   * Get all scheduled sessions (optionally filtered by project)
   * @param {string|null} projectId - Optional project ID to filter by
   * @returns {Promise<Array>}
   */
  async getScheduledSessions(projectId = null) {
    const params = projectId ? `?projectId=${projectId}` : '';
    return this.#request('GET', `/sessions/scheduled${params}`);
  }

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
    let path = `/projects/${projectId}/sessions`;
    const params = new URLSearchParams();

    if (archived !== null) {
      params.append('archived', archived);
    }
    if (starred === 'starred') {
      params.append('starred', true);
    } else if (starred === 'unstarred') {
      params.append('starred', false);
    }

    // Add pagination params
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }

    const query = params.toString();
    if (query) {
      path += `?${query}`;
    }
    return this.#request('GET', path);
  }

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
      const formData = new FormData();
      formData.append('prompt', jsonData.prompt);
      if (jsonData.name !== undefined) formData.append('name', jsonData.name);
      if (jsonData.mode !== undefined) formData.append('mode', jsonData.mode);
      if (jsonData.model !== undefined) formData.append('model', jsonData.model);
      if (jsonData.thinkingEnabled !== undefined) {
        formData.append('thinkingEnabled', String(jsonData.thinkingEnabled));
      }
      if (jsonData.startImmediately !== undefined) {
        formData.append('startImmediately', String(jsonData.startImmediately));
      }
      if (jsonData.gitBranch !== undefined) formData.append('gitBranch', jsonData.gitBranch);
      if (jsonData.gitMode !== undefined) formData.append('gitMode', jsonData.gitMode);
      if (jsonData.templateId !== undefined) formData.append('templateId', jsonData.templateId);

      for (const file of files) {
        formData.append('files', file);
      }

      const response = await fetch(`${this.#baseUrl}/projects/${projectId}/sessions`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    }

    return this.#request('POST', `/projects/${projectId}/sessions`, jsonData);
  }

  /**
   * Get a session by ID
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async getSession(id) {
    return this.#request('GET', `/sessions/${id}`);
  }

  /**
   * Get all messages for a session
   * @param {string} id - Session ID
   * @returns {Promise<Array>}
   */
  async getSessionMessages(id) {
    return this.#request('GET', `/sessions/${id}/messages`);
  }

  /**
   * Get work logs for a session (grouped by message ID)
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Work logs grouped by message ID
   */
  async getSessionWorkLogs(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/work-logs`);
  }

  /**
   * Send a message to a session
   * @param {string} sessionId - Session ID
   * @param {string} content - Message content
   * @param {Array} files - Optional array of files to attach
   * @returns {Promise<Object>}
   */
  async sendMessage(sessionId, content, files = []) {
    // Use FormData if files are attached, otherwise JSON
    if (files && files.length > 0) {
      const formData = new FormData();
      formData.append('content', content);

      for (const file of files) {
        formData.append('files', file);
      }

      const response = await fetch(`${this.#baseUrl}/sessions/${sessionId}/message`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    }

    return this.#request('POST', `/sessions/${sessionId}/message`, { content });
  }

  /**
   * Stop a session
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async stopSession(id) {
    return this.#request('POST', `/sessions/${id}/stop`);
  }

  /**
   * Get git changes for a session
   * @param {string} sessionId - Session ID
   * @param {string} compareMode - 'local' (default) or 'branch'
   * @param {string|null} branch - Branch to compare against (only used if compareMode is 'branch')
   * @returns {Promise<{staged: string, unstaged: string, untracked: string}>}
   */
  async getSessionChanges(sessionId, compareMode = 'local', branch = null) {
    let path = `/sessions/${sessionId}/changes`;
    const params = new URLSearchParams();

    if (compareMode === 'branch') {
      params.append('compareMode', 'branch');
      if (branch) {
        params.append('branch', branch);
      }
    }

    const query = params.toString();
    if (query) {
      path += `?${query}`;
    }

    return this.#request('GET', path);
  }

  /**
   * Get the default branch for a session (for branch comparison)
   * @param {string} sessionId
   * @returns {Promise<{branch: string}>}
   */
  async getSessionDefaultBranch(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/default-branch`);
  }

  /**
   * Get count of files modified compared to the default branch
   * @param {string} sessionId - Session ID
   * @returns {Promise<{count: number}>}
   */
  async getSessionFilesCount(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/files-count`);
  }

  /**
   * Get a file from the session's working directory (for displaying images in diffs)
   * @param {string} sessionId - Session ID
   * @param {string} filePath - Relative path to file
   * @returns {Promise<{data: string, mimeType: string, filename: string}>}
   */
  async getSessionFile(sessionId, filePath) {
    return this.#request('GET', `/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`);
  }

  /**
   * Restart a completed or errored session
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async restartSession(id) {
    return this.#request('POST', `/sessions/${id}/restart`);
  }

  /**
   * Start a draft session (waiting status with no assistant messages)
   * @param {string} id - Session ID
   * @param {string|undefined} prompt - Optional updated prompt to use when starting
   * @returns {Promise<Object>}
   */
  async startSession(id, prompt) {
    const data = prompt !== undefined ? { prompt } : undefined;
    return this.#request('POST', `/sessions/${id}/start`, data);
  }

  /**
   * Update the initial prompt for a draft session
   * @param {string} id - Session ID
   * @param {string} prompt - The new prompt
   * @returns {Promise<Object>}
   */
  async updateSessionInitialPrompt(id, prompt) {
    return this.#request('PUT', `/sessions/${id}/initial-prompt`, { prompt });
  }

  /**
   * Update session settings
   * @param {string} id - Session ID
   * @param {Object} data - Update data (e.g., { thinkingEnabled: true })
   * @returns {Promise<Object>}
   */
  async updateSession(id, data) {
    return this.#request('PATCH', `/sessions/${id}`, data);
  }

  /**
   * Update the pending prompt for a session (auto-save input field)
   * @param {string} id - Session ID
   * @param {string|null} pendingPrompt - The pending prompt (or null to clear)
   * @returns {Promise<Object>}
   */
  async updateSessionPendingPrompt(id, pendingPrompt) {
    return this.#request('PATCH', `/sessions/${id}/pending-prompt`, { pendingPrompt });
  }

  /**
   * Delete a session
   * @param {string} id - Session ID
   * @returns {Promise<void>}
   */
  async deleteSession(id) {
    return this.#request('DELETE', `/sessions/${id}`);
  }

  /**
   * Archive a session
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async archiveSession(id) {
    return this.#request('POST', `/sessions/${id}/archive`);
  }

  /**
   * Unarchive a session
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async unarchiveSession(id) {
    return this.#request('POST', `/sessions/${id}/unarchive`);
  }

  /**
   * Toggle star status for a session
   * @param {string} id - Session ID
   * @returns {Promise<Object>}
   */
  async toggleSessionStar(id) {
    return this.#request('POST', `/sessions/${id}/star`);
  }

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
    return this.#request('POST', `/sessions/${id}/duplicate`, options);
  }

  /**
   * Schedule a follow-up for an existing session
   * @param {string} id - Session ID
   * @param {Object} data - Scheduling data
   * @param {number} data.scheduledAt - Timestamp for when to start
   * @param {string} [data.prompt] - Optional follow-up message
   * @param {boolean} [data.autoRescheduleEnabled] - Enable auto-reschedule on errors
   * @param {number} [data.rescheduleDelayMinutes] - Delay between reschedules
   * @param {boolean} [data.rescheduleOnTokenLimit] - Reschedule on token limit errors
   * @param {boolean} [data.rescheduleOnServiceError] - Reschedule on service errors
   * @param {number|null} [data.maxRescheduleCount] - Max reschedule attempts
   * @param {number|null} [data.maxTotalTokens] - Max total tokens before stopping
   * @param {number|null} [data.rescheduleAtTokenCount] - Token threshold for proactive reschedule
   * @returns {Promise<Object>}
   */
  async scheduleSession(id, data) {
    return this.#request('POST', `/sessions/${id}/schedule`, data);
  }

  // Canvas

  /**
   * Get all canvas items for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getCanvasItems(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/canvas`);
  }

  /**
   * Upload a file to the canvas
   * @param {string} sessionId - Session ID
   * @param {File} file - File to upload
   * @returns {Promise<Object>}
   */
  async uploadCanvasItem(sessionId, file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.#baseUrl}/sessions/${sessionId}/canvas`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Create a canvas item with text/markdown/json content
   * @param {string} sessionId - Session ID
   * @param {Object} data - Canvas item data
   * @param {string} data.type - Type: 'text', 'markdown', 'json', 'code'
   * @param {string} data.content - Text content
   * @param {string|null} data.filename - Optional filename
   * @returns {Promise<Object>}
   */
  async createCanvasItem(sessionId, data) {
    return this.#request('POST', `/sessions/${sessionId}/canvas`, data);
  }

  /**
   * Delete a canvas item (soft delete - move to trash)
   * @param {string} sessionId - Session ID
   * @param {string} itemId - Canvas item ID
   * @returns {Promise<Object>}
   */
  async deleteCanvasItem(sessionId, itemId) {
    return this.#request('DELETE', `/sessions/${sessionId}/canvas/${itemId}`);
  }

  /**
   * Get trashed canvas items for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getCanvasTrash(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/canvas-trash`);
  }

  /**
   * Recover a single canvas item from trash
   * @param {string} sessionId - Session ID
   * @param {string} itemId - Canvas item ID
   * @returns {Promise<Object>}
   */
  async recoverCanvasItem(sessionId, itemId) {
    return this.#request('POST', `/sessions/${sessionId}/canvas/${itemId}/recover`);
  }

  /**
   * Recover all versions of a file from trash
   * @param {string} sessionId - Session ID
   * @param {string} filename - Filename
   * @returns {Promise<Object>}
   */
  async recoverCanvasFile(sessionId, filename) {
    return this.#request('POST', `/sessions/${sessionId}/canvas-trash/recover-file/${encodeURIComponent(filename)}`);
  }

  /**
   * Permanently delete a canvas item from trash
   * @param {string} sessionId - Session ID
   * @param {string} itemId - Canvas item ID
   * @returns {Promise<void>}
   */
  async permanentlyDeleteCanvasItem(sessionId, itemId) {
    return this.#request('DELETE', `/sessions/${sessionId}/canvas/${itemId}/permanent`);
  }

  /**
   * Soft delete multiple canvas items (move to trash)
   * @param {string} sessionId - Session ID
   * @param {string[]} itemIds - Array of canvas item IDs
   * @returns {Promise<Object>} - { deletedCount: number }
   */
  async bulkDeleteCanvasItems(sessionId, itemIds) {
    return this.#request('POST', `/sessions/${sessionId}/canvas/bulk-delete`, { itemIds });
  }

  /**
   * Recover multiple canvas items from trash
   * @param {string} sessionId - Session ID
   * @param {string[]} itemIds - Array of canvas item IDs
   * @returns {Promise<Object>} - { recoveredCount: number }
   */
  async bulkRecoverCanvasItems(sessionId, itemIds) {
    return this.#request('POST', `/sessions/${sessionId}/canvas/bulk-recover`, { itemIds });
  }

  /**
   * Permanently delete multiple canvas items from trash
   * @param {string} sessionId - Session ID
   * @param {string[]} itemIds - Array of canvas item IDs
   * @returns {Promise<Object>} - { deletedCount: number }
   */
  async bulkPermanentlyDeleteCanvasItems(sessionId, itemIds) {
    return this.#request('DELETE', `/sessions/${sessionId}/canvas/bulk-delete-permanent`, { itemIds });
  }

  // Git

  /**
   * Get git status for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>}
   */
  async getGitStatus(projectId) {
    return this.#request('GET', `/git/projects/${projectId}/status`);
  }

  /**
   * Get worktrees for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>}
   */
  async getWorktrees(projectId) {
    return this.#request('GET', `/git/projects/${projectId}/worktrees`);
  }

  // Todos

  /**
   * Get all todos for a session (or specific conversation)
   * @param {string} sessionId - Session ID
   * @param {string} [conversationId] - Optional conversation ID to fetch todos for
   * @returns {Promise<Array>}
   */
  async getSessionTodos(sessionId, conversationId = null) {
    const params = conversationId ? `?conversation_id=${conversationId}` : '';
    return this.#request('GET', `/sessions/${sessionId}/todos${params}`);
  }

  // Summaries

  /**
   * Get session summary
   * @param {string} sessionId - Session ID
   * @param {boolean} generateIfMissing - Generate summary if not found
   * @returns {Promise<Object|null>}
   */
  async getSessionSummary(sessionId, generateIfMissing = false) {
    const params = generateIfMissing ? '?generate=true' : '';
    try {
      return await this.#request('GET', `/sessions/${sessionId}/summary${params}`);
    } catch (err) {
      // Return null instead of throwing for 404 (no summary yet)
      if (err.message.includes('404') || err.message.includes('not found')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Generate/regenerate session summary
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>}
   */
  async generateSessionSummary(sessionId) {
    return this.#request('POST', `/sessions/${sessionId}/summary`);
  }

  // Notes

  /**
   * Get all notes for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getSessionNotes(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/notes`);
  }

  /**
   * Create a note for a session
   * @param {string} sessionId - Session ID
   * @param {string} content - Note content
   * @returns {Promise<Object>}
   */
  async createNote(sessionId, content) {
    return this.#request('POST', `/sessions/${sessionId}/notes`, { content });
  }

  /**
   * Update a note
   * @param {string} sessionId - Session ID
   * @param {string} noteId - Note ID
   * @param {string} content - Updated note content
   * @returns {Promise<Object>}
   */
  async updateNote(sessionId, noteId, content) {
    return this.#request('PUT', `/sessions/${sessionId}/notes/${noteId}`, { content });
  }

  /**
   * Delete a note
   * @param {string} sessionId - Session ID
   * @param {string} noteId - Note ID
   * @returns {Promise<void>}
   */
  async deleteNote(sessionId, noteId) {
    return this.#request('DELETE', `/sessions/${sessionId}/notes/${noteId}`);
  }

  // Filesystem

  /**
   * Browse a directory
   * @param {string} path - Directory path to browse (defaults to home directory if empty)
   * @returns {Promise<{path: string, parent: string|null, entries: Array<{name: string, type: string}>, error: string|null}>}
   */
  async browseDirectory(path = '') {
    const params = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.#request('GET', `/filesystem/browse${params}`);
  }

  // Templates

  /**
   * Get all global templates
   * @returns {Promise<Array>}
   */
  async getGlobalTemplates() {
    return this.#request('GET', '/templates');
  }

  /**
   * Create a global template
   * @param {Object} data - Template data
   * @returns {Promise<Object>}
   */
  async createGlobalTemplate(data) {
    return this.#request('POST', '/templates', data);
  }

  /**
   * Get a template by ID
   * @param {string} id - Template ID
   * @returns {Promise<Object>}
   */
  async getTemplate(id) {
    return this.#request('GET', `/templates/${id}`);
  }

  /**
   * Update a template
   * @param {string} id - Template ID
   * @param {Object} data - Updated template data
   * @returns {Promise<Object>}
   */
  async updateTemplate(id, data) {
    return this.#request('PATCH', `/templates/${id}`, data);
  }

  /**
   * Delete a template
   * @param {string} id - Template ID
   * @returns {Promise<void>}
   */
  async deleteTemplate(id) {
    return this.#request('DELETE', `/templates/${id}`);
  }

  /**
   * Get templates for a project (includes both project and global templates)
   * @param {string} projectId - Project ID
   * @returns {Promise<{project: Array, global: Array}>}
   */
  async getProjectTemplates(projectId) {
    return this.#request('GET', `/projects/${projectId}/templates`);
  }

  /**
   * Create a project template
   * @param {string} projectId - Project ID
   * @param {Object} data - Template data
   * @returns {Promise<Object>}
   */
  async createProjectTemplate(projectId, data) {
    return this.#request('POST', `/projects/${projectId}/templates`, data);
  }

  // Conversations

  /**
   * Get all conversations for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getConversations(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/conversations`);
  }

  /**
   * Create a new conversation
   * @param {string} sessionId - Session ID
   * @param {string|null} name - Optional conversation name
   * @returns {Promise<Object>}
   */
  async createConversation(sessionId, name = null) {
    return this.#request('POST', `/sessions/${sessionId}/conversations`, { name });
  }

  /**
   * Get a specific conversation
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>}
   */
  async getConversation(sessionId, conversationId) {
    return this.#request('GET', `/sessions/${sessionId}/conversations/${conversationId}`);
  }

  /**
   * Update a conversation
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Conversation ID
   * @param {Object} data - Update data (name, isActive)
   * @returns {Promise<Object>}
   */
  async updateConversation(sessionId, conversationId, data) {
    return this.#request('PATCH', `/sessions/${sessionId}/conversations/${conversationId}`, data);
  }

  /**
   * Delete a conversation
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async deleteConversation(sessionId, conversationId) {
    return this.#request('DELETE', `/sessions/${sessionId}/conversations/${conversationId}`);
  }

  /**
   * Generate summary for a conversation
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>}
   */
  async generateConversationSummary(sessionId, conversationId) {
    return this.#request('POST', `/sessions/${sessionId}/conversations/${conversationId}/summary`);
  }

  /**
   * Create a branch from a conversation at a specific message
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Source conversation ID
   * @param {Object} data - Branch data
   * @param {string} data.messageId - Message ID to branch from
   * @param {string} [data.name] - Optional name for the branch
   * @param {string} [data.prompt] - Optional initial prompt for the branch
   * @returns {Promise<Object>} The created branch conversation
   */
  async branchConversation(sessionId, conversationId, data) {
    return this.#request('POST', `/sessions/${sessionId}/conversations/${conversationId}/branch`, data);
  }

  /**
   * Get messages for a specific conversation
   * @param {string} sessionId - Session ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Array>}
   */
  async getConversationMessages(sessionId, conversationId) {
    return this.#request('GET', `/sessions/${sessionId}/messages?conversation_id=${conversationId}`);
  }

  // Command Buttons

  /**
   * Get all command buttons for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>}
   */
  async getCommandButtons(projectId) {
    return this.#request('GET', `/projects/${projectId}/command-buttons`);
  }

  /**
   * Create a new command button
   * @param {string} projectId - Project ID
   * @param {Object} data - Button data
   * @returns {Promise<Object>}
   */
  async createCommandButton(projectId, data) {
    return this.#request('POST', `/projects/${projectId}/command-buttons`, data);
  }

  /**
   * Get a specific command button
   * @param {string} projectId - Project ID
   * @param {string} buttonId - Button ID
   * @returns {Promise<Object>}
   */
  async getCommandButton(projectId, buttonId) {
    return this.#request('GET', `/projects/${projectId}/command-buttons/${buttonId}`);
  }

  /**
   * Update a command button
   * @param {string} projectId - Project ID
   * @param {string} buttonId - Button ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>}
   */
  async updateCommandButton(projectId, buttonId, data) {
    return this.#request('PATCH', `/projects/${projectId}/command-buttons/${buttonId}`, data);
  }

  /**
   * Delete a command button
   * @param {string} projectId - Project ID
   * @param {string} buttonId - Button ID
   * @returns {Promise<void>}
   */
  async deleteCommandButton(projectId, buttonId) {
    return this.#request('DELETE', `/projects/${projectId}/command-buttons/${buttonId}`);
  }

  /**
   * Run a command button
   * @param {string} sessionId - Session ID
   * @param {string} buttonId - Button ID
   * @returns {Promise<Object>}
   */
  async runCommandButton(sessionId, buttonId) {
    return this.#request('POST', `/sessions/${sessionId}/command-buttons/${buttonId}/run`);
  }

  /**
   * Get active command runs for a session (both running and recently completed)
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getActiveRuns(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/command-buttons/runs`);
  }

  /**
   * Get a single command run by ID
   * @param {string} sessionId - Session ID
   * @param {string} runId - Run ID
   * @returns {Promise<Object>}
   */
  async getCommandRun(sessionId, runId) {
    return this.#request('GET', `/sessions/${sessionId}/command-buttons/runs/${runId}`);
  }

  /**
   * Get the latest run for each button per session within a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>}
   */
  async getLatestRunsForProject(projectId) {
    return this.#request('GET', `/projects/${projectId}/command-buttons/latest-runs`);
  }

  /**
   * Kill a running command
   * @param {string} sessionId - Session ID
   * @param {string} runId - Run ID
   * @returns {Promise<Object>}
   */
  async killCommandRun(sessionId, runId) {
    return this.#request('POST', `/sessions/${sessionId}/command-buttons/runs/${runId}/kill`);
  }

  // Project Session Defaults

  /**
   * Get session defaults for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Object|null>}
   */
  async getProjectSessionDefaults(projectId) {
    return this.#request('GET', `/projects/${projectId}/session-defaults`);
  }

  /**
   * Update/create session defaults for a project
   * @param {string} projectId - Project ID
   * @param {Object} data - Defaults data
   * @returns {Promise<Object>}
   */
  async updateProjectSessionDefaults(projectId, data) {
    return this.#request('POST', `/projects/${projectId}/session-defaults`, data);
  }

  /**
   * Reset session defaults for a project to system defaults
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>}
   */
  async resetProjectSessionDefaults(projectId) {
    return this.#request('DELETE', `/projects/${projectId}/session-defaults`);
  }

  // Quick Responses

  /**
   * Get quick responses for a project (includes both project-specific and global)
   * @param {string} projectId - Project ID
   * @returns {Promise<{project: Array, global: Array}>}
   */
  async getQuickResponses(projectId) {
    return this.#request('GET', `/projects/${projectId}/quick-responses`);
  }

  /**
   * Get global quick responses only
   * @returns {Promise<Array>}
   */
  async getGlobalQuickResponses() {
    return this.#request('GET', '/quick-responses/global');
  }

  /**
   * Create a quick response
   * @param {string} projectId - Project ID
   * @param {Object} data - Quick response data
   * @returns {Promise<Object>}
   */
  async createQuickResponse(projectId, data) {
    return this.#request('POST', `/projects/${projectId}/quick-responses`, data);
  }

  /**
   * Update a quick response
   * @param {string} id - Quick response ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>}
   */
  async updateQuickResponse(id, data) {
    return this.#request('PATCH', `/quick-responses/${id}`, data);
  }

  /**
   * Delete a quick response
   * @param {string} id - Quick response ID
   * @returns {Promise<void>}
   */
  async deleteQuickResponse(id) {
    return this.#request('DELETE', `/quick-responses/${id}`);
  }

  /**
   * Reorder quick responses for a project
   * @param {string} projectId - Project ID
   * @param {Array<{id: string, sortOrder: number}>} orders - Array of id/sortOrder pairs
   * @returns {Promise<{project: Array, global: Array}>}
   */
  async reorderQuickResponses(projectId, orders) {
    return this.#request('POST', `/projects/${projectId}/quick-responses/reorder`, orders);
  }

  /**
   * Reorder global quick responses
   * @param {Array<{id: string, sortOrder: number}>} orders - Array of id/sortOrder pairs
   * @returns {Promise<Array>}
   */
  async reorderGlobalQuickResponses(orders) {
    return this.#request('POST', '/quick-responses/global/reorder', orders);
  }

  // Settings

  /**
   * Get token cost weights
   * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
   */
  async getTokenCostWeights() {
    return this.#request('GET', '/settings/token-weights');
  }

  /**
   * Update token cost weights
   * @param {Object} weights - Token cost weights
   * @param {number} weights.input - Input token weight
   * @param {number} weights.output - Output token weight
   * @param {number} weights.cacheRead - Cache read token weight
   * @param {number} weights.cacheCreation - Cache creation token weight
   * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
   */
  async updateTokenCostWeights(weights) {
    return this.#request('PUT', '/settings/token-weights', weights);
  }

  /**
   * Reset token cost weights to defaults
   * @returns {Promise<{input: number, output: number, cacheRead: number, cacheCreation: number}>}
   */
  async resetTokenCostWeights() {
    return this.#request('DELETE', '/settings/token-weights');
  }

  // Model Providers

  /**
   * Get all model providers
   * @returns {Promise<Array>}
   */
  async getProviders() {
    return this.#request('GET', '/providers');
  }

  /**
   * Get a provider by ID
   * @param {string} id - Provider ID
   * @returns {Promise<Object>}
   */
  async getProvider(id) {
    return this.#request('GET', `/providers/${id}`);
  }

  /**
   * Create a new provider
   * @param {Object} data - Provider data
   * @returns {Promise<Object>}
   */
  async createProvider(data) {
    return this.#request('POST', '/providers', data);
  }

  /**
   * Update a provider
   * @param {string} id - Provider ID
   * @param {Object} data - Updated provider data
   * @returns {Promise<Object>}
   */
  async updateProvider(id, data) {
    return this.#request('PATCH', `/providers/${id}`, data);
  }

  /**
   * Delete a provider
   * @param {string} id - Provider ID
   * @returns {Promise<void>}
   */
  async deleteProvider(id) {
    return this.#request('DELETE', `/providers/${id}`);
  }

  /**
   * Set a provider as default
   * @param {string} id - Provider ID
   * @returns {Promise<Object>}
   */
  async setDefaultProvider(id) {
    return this.#request('POST', `/providers/${id}/default`);
  }

  /**
   * Test a provider configuration
   * @param {Object} config - Provider configuration to test
   * @returns {Promise<{success: boolean, message: string, details?: Object}>}
   */
  async testProviderConnection(config) {
    return this.#request('POST', '/providers/test', config);
  }

  /**
   * Test an existing provider
   * @param {string} id - Provider ID
   * @returns {Promise<{success: boolean, message: string, details?: Object}>}
   */
  async testExistingProvider(id) {
    return this.#request('POST', `/providers/${id}/test`);
  }

  /**
   * Get models for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>}
   */
  async getProviderModels(providerId) {
    return this.#request('GET', `/providers/${providerId}/models`);
  }

  /**
   * Add a model to a provider
   * @param {string} providerId - Provider ID
   * @param {Object} data - Model data
   * @returns {Promise<Object>}
   */
  async addProviderModel(providerId, data) {
    return this.#request('POST', `/providers/${providerId}/models`, data);
  }

  /**
   * Remove a model from a provider
   * @param {string} providerId - Provider ID
   * @param {string} modelId - Model ID
   * @returns {Promise<void>}
   */
  async removeProviderModel(providerId, modelId) {
    return this.#request('DELETE', `/providers/${providerId}/models/${modelId}`);
  }

  // Slash Commands

  /**
   * Get all available slash commands for a directory
   * @param {string} directory - Working directory to discover commands from
   * @returns {Promise<Array>} Array of command objects
   */
  async getSlashCommands(directory) {
    return this.#request('GET', `/commands?directory=${encodeURIComponent(directory)}`);
  }

  /**
   * Get a single slash command by name
   * @param {string} directory - Working directory to discover commands from
   * @param {string} name - Command name
   * @returns {Promise<Object>} Command object
   */
  async getSlashCommand(directory, name) {
    return this.#request('GET', `/commands/${encodeURIComponent(name)}?directory=${encodeURIComponent(directory)}`);
  }

  /**
   * Execute a slash command in a session
   * @param {string} sessionId - Session to execute command in
   * @param {string} name - Command name
   * @param {Object} args - Argument values keyed by argument name
   * @returns {Promise<Object>} Execution result
   */
  async executeSlashCommand(sessionId, name, args = {}) {
    return this.#request('POST', `/commands/${encodeURIComponent(name)}/execute`, {
      sessionId,
      args,
    });
  }
}

// Singleton instance
export const api = new ApiClient();
