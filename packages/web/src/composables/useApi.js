import { ref } from 'vue';

const BASE_URL = '/api';

/**
 * HTTP client wrapper
 */
export function useApi() {
  const loading = ref(false);
  const error = ref(null);

  async function request(method, path, data = null) {
    loading.value = true;
    error.value = null;

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(`${BASE_URL}${path}`, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    error,
    get: (path) => request('GET', path),
    post: (path, data) => request('POST', path, data),
    put: (path, data) => request('PUT', path, data),
    delete: (path) => request('DELETE', path),
  };
}

// Standalone API functions
export const api = {
  // Projects
  async getProjects() {
    const response = await fetch(`${BASE_URL}/projects`);
    if (!response.ok) throw new Error('Failed to fetch projects');
    return response.json();
  },

  async getProject(id) {
    const response = await fetch(`${BASE_URL}/projects/${id}`);
    if (!response.ok) throw new Error('Failed to fetch project');
    return response.json();
  },

  async createProject(data) {
    const response = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create project');
    return response.json();
  },

  async updateProject(id, data) {
    const response = await fetch(`${BASE_URL}/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update project');
    return response.json();
  },

  async deleteProject(id) {
    const response = await fetch(`${BASE_URL}/projects/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete project');
  },

  // Sessions
  async getProjectSessions(projectId) {
    const response = await fetch(`${BASE_URL}/projects/${projectId}/sessions`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  },

  async createSession(projectId, data) {
    const response = await fetch(`${BASE_URL}/projects/${projectId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
  },

  async getSession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}`);
    if (!response.ok) throw new Error('Failed to fetch session');
    return response.json();
  },

  async getSessionMessages(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}/messages`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  },

  async sendMessage(sessionId, content) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  },

  async stopSession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}/stop`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to stop session');
    return response.json();
  },

  // Canvas
  async getCanvasItems(sessionId) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/canvas`);
    if (!response.ok) throw new Error('Failed to fetch canvas items');
    return response.json();
  },

  async deleteCanvasItem(sessionId, itemId) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/canvas/${itemId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete canvas item');
  },

  // Git
  async getGitStatus(projectId) {
    const response = await fetch(`${BASE_URL}/git/projects/${projectId}/status`);
    if (!response.ok) throw new Error('Failed to fetch git status');
    return response.json();
  },

  async getWorktrees(projectId) {
    const response = await fetch(`${BASE_URL}/git/projects/${projectId}/worktrees`);
    if (!response.ok) throw new Error('Failed to fetch worktrees');
    return response.json();
  },

  // Notes
  async getSessionNotes(sessionId) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/notes`);
    if (!response.ok) throw new Error('Failed to fetch notes');
    return response.json();
  },

  async createNote(sessionId, content) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to create note');
    return response.json();
  },

  async updateNote(sessionId, noteId, content) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to update note');
    return response.json();
  },

  async deleteNote(sessionId, noteId) {
    const response = await fetch(`${BASE_URL}/sessions/${sessionId}/notes/${noteId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete note');
  },
};
