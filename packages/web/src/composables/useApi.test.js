import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, api } from './useApi.js';

describe('ApiClient', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockResponse = (data, options = {}) => {
    return Promise.resolve({
      ok: options.ok !== undefined ? options.ok : true,
      status: options.status || 200,
      json: () => Promise.resolve(data),
    });
  };

  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(ApiClient).toBeTypeOf('function');
      expect(api).toBeInstanceOf(ApiClient);
    });

    it('uses default base URL', () => {
      const client = new ApiClient();
      expect(client.baseUrl).toBe('/api');
    });

    it('accepts custom base URL', () => {
      const client = new ApiClient('http://localhost:3000/api');
      expect(client.baseUrl).toBe('http://localhost:3000/api');
    });
  });

  describe('projects', () => {
    it('has project methods', () => {
      expect(api.getProjects).toBeTypeOf('function');
      expect(api.getProject).toBeTypeOf('function');
      expect(api.createProject).toBeTypeOf('function');
      expect(api.updateProject).toBeTypeOf('function');
      expect(api.deleteProject).toBeTypeOf('function');
    });

    it('getProjects fetches from /api/projects', async () => {
      const mockData = [{ id: '1', name: 'Test' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getProjects();

      expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }));
      expect(result).toEqual(mockData);
    });

    it('getProject fetches by ID', async () => {
      const mockData = { id: '123', name: 'Test' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getProject('123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('createProject posts to /api/projects', async () => {
      const projectData = { name: 'New Project', workingDirectory: '/tmp' };
      const mockData = { id: '1', ...projectData };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.createProject(projectData);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(projectData),
      }));
      expect(result).toEqual(mockData);
    });

    it('updateProject puts to /api/projects/:id', async () => {
      const updateData = { name: 'Updated' };
      const mockData = { id: '123', name: 'Updated' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.updateProject('123', updateData);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(updateData),
      }));
      expect(result).toEqual(mockData);
    });

    it('deleteProject deletes /api/projects/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await api.deleteProject('123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('sessions', () => {
    it('has session methods', () => {
      expect(api.getProjectSessions).toBeTypeOf('function');
      expect(api.createSession).toBeTypeOf('function');
      expect(api.getSession).toBeTypeOf('function');
      expect(api.getSessionMessages).toBeTypeOf('function');
      expect(api.sendMessage).toBeTypeOf('function');
      expect(api.stopSession).toBeTypeOf('function');
    });

    it('getProjectSessions fetches sessions for a project', async () => {
      const mockData = [{ id: '1', name: 'Session 1' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getProjectSessions('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('createSession posts with project ID', async () => {
      const sessionData = { name: 'New Session', prompt: 'Hello' };
      const mockData = { id: '1', ...sessionData };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.createSession('proj-123', sessionData);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(sessionData),
      }));
      expect(result).toEqual(mockData);
    });

    it('getSession fetches by ID', async () => {
      const mockData = { id: 'sess-123', name: 'Test' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('getSessionMessages fetches messages', async () => {
      const mockData = [{ id: '1', role: 'user', content: 'Hello' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getSessionMessages('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/messages', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('sendMessage posts content', async () => {
      const mockData = { id: '1', role: 'user', content: 'Hello' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.sendMessage('sess-123', 'Hello');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/message', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Hello' }),
      }));
      expect(result).toEqual(mockData);
    });

    it('stopSession posts to stop endpoint', async () => {
      const mockData = { id: 'sess-123', status: 'stopped' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.stopSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/stop', expect.objectContaining({
        method: 'POST',
      }));
      expect(result).toEqual(mockData);
    });
  });

  describe('canvas', () => {
    it('has canvas methods', () => {
      expect(api.getCanvasItems).toBeTypeOf('function');
      expect(api.deleteCanvasItem).toBeTypeOf('function');
    });

    it('getCanvasItems fetches items for a session', async () => {
      const mockData = [{ id: '1', type: 'markdown', content: '# Hello' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getCanvasItems('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('deleteCanvasItem deletes by session and item ID', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await api.deleteCanvasItem('sess-123', 'item-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/item-456', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('git', () => {
    it('has git methods', () => {
      expect(api.getGitStatus).toBeTypeOf('function');
      expect(api.getWorktrees).toBeTypeOf('function');
    });

    it('getGitStatus fetches status for a project', async () => {
      const mockData = { isRepo: true, branch: 'main' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getGitStatus('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/status', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('getWorktrees fetches worktrees for a project', async () => {
      const mockData = [{ path: '/tmp/worktree', branch: 'feature' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getWorktrees('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/worktrees', expect.any(Object));
      expect(result).toEqual(mockData);
    });
  });

  describe('notes', () => {
    it('has note methods', () => {
      expect(api.getSessionNotes).toBeTypeOf('function');
      expect(api.createNote).toBeTypeOf('function');
      expect(api.updateNote).toBeTypeOf('function');
      expect(api.deleteNote).toBeTypeOf('function');
    });

    it('getSessionNotes fetches notes for a session', async () => {
      const mockData = [{ id: '1', content: 'Note 1' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.getSessionNotes('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it('createNote posts content', async () => {
      const mockData = { id: '1', content: 'New note' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.createNote('sess-123', 'New note');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'New note' }),
      }));
      expect(result).toEqual(mockData);
    });

    it('updateNote puts content', async () => {
      const mockData = { id: 'note-456', content: 'Updated' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await api.updateNote('sess-123', 'note-456', 'Updated');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-456', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ content: 'Updated' }),
      }));
      expect(result).toEqual(mockData);
    });

    it('deleteNote deletes by session and note ID', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await api.deleteNote('sess-123', 'note-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-456', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response with error message', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid request' }),
      }));

      await expect(api.getProjects()).rejects.toThrow('Invalid request');
    });

    it('throws with HTTP status when no error message', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      }));

      await expect(api.getProjects()).rejects.toThrow('HTTP 500');
    });

    it('returns null for 204 responses', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      const result = await api.deleteProject('123');

      expect(result).toBeNull();
    });
  });

  describe('custom base URL', () => {
    it('uses custom base URL in requests', async () => {
      const client = new ApiClient('http://api.example.com');
      mockFetch.mockReturnValue(mockResponse([{ id: '1' }]));

      await client.getProjects();

      expect(mockFetch).toHaveBeenCalledWith('http://api.example.com/projects', expect.any(Object));
    });
  });
});
