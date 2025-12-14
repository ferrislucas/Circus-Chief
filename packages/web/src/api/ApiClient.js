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
   * Get all sessions for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>}
   */
  async getProjectSessions(projectId) {
    return this.#request('GET', `/projects/${projectId}/sessions`);
  }

  /**
   * Create a new session
   * @param {string} projectId - Project ID
   * @param {Object} data - Session data
   * @returns {Promise<Object>}
   */
  async createSession(projectId, data) {
    return this.#request('POST', `/projects/${projectId}/sessions`, data);
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
   * Send a message to a session
   * @param {string} sessionId - Session ID
   * @param {string} content - Message content
   * @returns {Promise<Object>}
   */
  async sendMessage(sessionId, content) {
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
   * @returns {Promise<{staged: string, unstaged: string}>}
   */
  async getSessionChanges(sessionId) {
    return this.#request('GET', `/sessions/${sessionId}/changes`);
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
   * Delete a canvas item
   * @param {string} sessionId - Session ID
   * @param {string} itemId - Canvas item ID
   * @returns {Promise<void>}
   */
  async deleteCanvasItem(sessionId, itemId) {
    return this.#request('DELETE', `/sessions/${sessionId}/canvas/${itemId}`);
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
}

// Singleton instance
export const api = new ApiClient();
