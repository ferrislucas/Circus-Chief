import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './ApiClient.js';

describe('ApiClient', () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    client = new ApiClient();
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

  describe('constructor', () => {
    it('creates instance with default base URL', () => {
      const instance = new ApiClient();
      expect(instance.baseUrl).toBe('/api');
    });

    it('accepts custom base URL', () => {
      const instance = new ApiClient('http://localhost:3000/api');
      expect(instance.baseUrl).toBe('http://localhost:3000/api');
    });
  });

  describe('baseUrl getter', () => {
    it('returns the base URL', () => {
      expect(client.baseUrl).toBe('/api');
    });
  });

  describe('projects', () => {
    describe('getProjects', () => {
      it('fetches from /api/projects', async () => {
        const mockData = [{ id: '1', name: 'Test' }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjects();

        expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
          method: 'GET',
        }));
        expect(result).toEqual(mockData);
      });
    });

    describe('getProject', () => {
      it('fetches project by ID', async () => {
        const mockData = { id: '123', name: 'Test' };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProject('123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('createProject', () => {
      it('posts to /api/projects', async () => {
        const projectData = { name: 'New', workingDirectory: '/tmp' };
        const mockData = { id: '1', ...projectData };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.createProject(projectData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(projectData),
        }));
        expect(result).toEqual(mockData);
      });
    });

    describe('updateProject', () => {
      it('puts to /api/projects/:id', async () => {
        const updateData = { name: 'Updated' };
        mockFetch.mockReturnValue(mockResponse({ id: '123', ...updateData }));

        await client.updateProject('123', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(updateData),
        }));
      });
    });

    describe('deleteProject', () => {
      it('deletes /api/projects/:id', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteProject('123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });
  });

  describe('sessions', () => {
    describe('getProjectSessions', () => {
      it('fetches sessions for project', async () => {
        const mockData = [{ id: '1', name: 'Session' }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjectSessions('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.any(Object));
        expect(result).toEqual(mockData);
      });

      it('fetches archived sessions when archived=true', async () => {
        const mockData = [{ id: '1', name: 'Archived Session', archived: true }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjectSessions('proj-123', true);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?archived=true', expect.any(Object));
        expect(result).toEqual(mockData);
      });

      it('fetches non-archived sessions when archived=false', async () => {
        const mockData = [{ id: '1', name: 'Active Session', archived: false }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjectSessions('proj-123', false);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?archived=false', expect.any(Object));
        expect(result).toEqual(mockData);
      });

      it('fetches all sessions when archived=null', async () => {
        const mockData = [{ id: '1' }, { id: '2' }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjectSessions('proj-123', null);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('archiveSession', () => {
      it('posts to archive endpoint', async () => {
        const mockData = { id: 'sess-123', archived: true };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.archiveSession('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/archive', expect.objectContaining({
          method: 'POST',
        }));
        expect(result.archived).toBe(true);
      });
    });

    describe('unarchiveSession', () => {
      it('posts to unarchive endpoint', async () => {
        const mockData = { id: 'sess-123', archived: false };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.unarchiveSession('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/unarchive', expect.objectContaining({
          method: 'POST',
        }));
        expect(result.archived).toBe(false);
      });
    });

    describe('createSession', () => {
      it('posts to /api/projects/:id/sessions with JSON when no files', async () => {
        const sessionData = { name: 'New Session', prompt: 'Hello' };
        mockFetch.mockReturnValue(mockResponse({ id: '1', ...sessionData }));

        await client.createSession('proj-123', sessionData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(sessionData),
        }));
      });

      it('uses FormData when files are attached', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
        const sessionData = {
          prompt: 'Hello',
          mode: 'standard',
          thinkingEnabled: true,
          files: [file],
        };

        await client.createSession('proj-123', sessionData);

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1].body).toBeInstanceOf(FormData);
        const formData = callArgs[1].body;
        expect(formData.get('prompt')).toBe('Hello');
        expect(formData.get('mode')).toBe('standard');
        expect(formData.get('thinkingEnabled')).toBe('true');
        expect(formData.getAll('files')).toHaveLength(1);
      });

      it('uses JSON when files array is empty', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        const sessionData = { prompt: 'Hello', files: [] };
        await client.createSession('proj-123', sessionData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Hello' }),
        }));
      });

      it('includes model in FormData when files are attached', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
        const sessionData = {
          prompt: 'Hello',
          model: 'claude-opus-4-5-20251101',
          files: [file],
        };

        await client.createSession('proj-123', sessionData);

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1].body).toBeInstanceOf(FormData);
        const formData = callArgs[1].body;
        expect(formData.get('model')).toBe('claude-opus-4-5-20251101');
      });

      it('includes model in JSON when no files', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        const sessionData = { prompt: 'Hello', model: 'claude-haiku-4-5-20251001' };
        await client.createSession('proj-123', sessionData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(sessionData),
        }));
      });
    });

    describe('getSession', () => {
      it('fetches session by ID', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'sess-123' }));

        await client.getSession('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.any(Object));
      });
    });

    describe('getSessionMessages', () => {
      it('fetches messages for session', async () => {
        mockFetch.mockReturnValue(mockResponse([{ id: '1', content: 'Hello' }]));

        await client.getSessionMessages('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/messages', expect.any(Object));
      });
    });

    describe('sendMessage', () => {
      it('posts message content with JSON when no files', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        await client.sendMessage('sess-123', 'Hello');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/message', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello' }),
        }));
      });

      it('uses FormData when files are attached', async () => {
        mockFetch.mockReturnValue(mockResponse({ success: true }));

        const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
        await client.sendMessage('sess-123', 'Hello', [file]);

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1].body).toBeInstanceOf(FormData);
        const formData = callArgs[1].body;
        expect(formData.get('content')).toBe('Hello');
        expect(formData.getAll('files')).toHaveLength(1);
      });

      it('uses JSON when files array is empty', async () => {
        mockFetch.mockReturnValue(mockResponse({ success: true }));

        await client.sendMessage('sess-123', 'Hello', []);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/message', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello' }),
        }));
      });

      it('handles multiple files', async () => {
        mockFetch.mockReturnValue(mockResponse({ success: true }));

        const files = [
          new File(['content1'], 'file1.txt', { type: 'text/plain' }),
          new File(['content2'], 'file2.txt', { type: 'text/plain' }),
        ];
        await client.sendMessage('sess-123', 'Hello', files);

        const callArgs = mockFetch.mock.calls[0];
        const formData = callArgs[1].body;
        expect(formData.getAll('files')).toHaveLength(2);
      });
    });

    describe('stopSession', () => {
      it('posts to stop endpoint', async () => {
        mockFetch.mockReturnValue(mockResponse({ status: 'stopped' }));

        await client.stopSession('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/stop', expect.objectContaining({
          method: 'POST',
        }));
      });
    });

    describe('getSessionChanges', () => {
      it('fetches changes for session', async () => {
        const mockData = { staged: 'staged diff', unstaged: 'unstaged diff', untracked: '' };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getSessionChanges('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/changes', expect.any(Object));
        expect(result).toEqual(mockData);
      });

      it('returns all three change types', async () => {
        const mockData = {
          staged: 'staged diff content',
          unstaged: 'unstaged diff content',
          untracked: 'untracked files content',
        };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getSessionChanges('sess-123');

        expect(result).toEqual(mockData);
        expect(result).toHaveProperty('staged');
        expect(result).toHaveProperty('unstaged');
        expect(result).toHaveProperty('untracked');
      });

      it('returns empty strings when no changes', async () => {
        mockFetch.mockReturnValue(mockResponse({ staged: '', unstaged: '', untracked: '' }));

        const result = await client.getSessionChanges('sess-123');

        expect(result).toEqual({ staged: '', unstaged: '', untracked: '' });
      });

      it('accepts compareMode parameter with default value', async () => {
        mockFetch.mockReturnValue(mockResponse({
          staged: '',
          unstaged: '',
          untracked: '',
        }));

        // Call without compareMode (should default to 'local')
        await client.getSessionChanges('sess-123');

        // Verify the URL is simple without query parameters (local mode doesn't add params)
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toBe('/api/sessions/sess-123/changes');
        expect(callUrl).not.toContain('?');
      });

      it('accepts branch parameter when compareMode is branch', async () => {
        mockFetch.mockReturnValue(mockResponse({
          staged: 'branch changes',
          unstaged: '',
          untracked: '',
        }));

        // Call with branch compareMode and branch name
        await client.getSessionChanges('sess-123', 'branch', 'main');

        // Verify the URL includes query parameters
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toBe('/api/sessions/sess-123/changes?compareMode=branch&branch=main');
      });

      it('includes compareMode parameter without branch when branch is null', async () => {
        mockFetch.mockReturnValue(mockResponse({
          staged: '',
          unstaged: '',
          untracked: '',
        }));

        // Call with branch compareMode but no branch name
        await client.getSessionChanges('sess-123', 'branch', null);

        // Verify the URL includes only compareMode parameter
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toBe('/api/sessions/sess-123/changes?compareMode=branch');
      });

      it('does not include query parameters when compareMode is local', async () => {
        mockFetch.mockReturnValue(mockResponse({
          staged: 'local changes',
          unstaged: '',
          untracked: '',
        }));

        // Call with explicit local compareMode
        await client.getSessionChanges('test-session-id', 'local');

        // Verify only sessionId is used in the URL (no query params for local mode)
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toBe('/api/sessions/test-session-id/changes');
        expect(callUrl).not.toContain('?');
      });
    });

    describe('updateSession', () => {
      it('patches session settings', async () => {
        const updateData = { thinkingEnabled: true };
        mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', thinkingEnabled: true }));

        const result = await client.updateSession('sess-123', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updateData),
        }));
        expect(result.thinkingEnabled).toBe(true);
      });

      it('updates thinkingEnabled to false', async () => {
        const updateData = { thinkingEnabled: false };
        mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', thinkingEnabled: false }));

        const result = await client.updateSession('sess-123', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updateData),
        }));
        expect(result.thinkingEnabled).toBe(false);
      });
    });
  });

  describe('canvas', () => {
    describe('getCanvasItems', () => {
      it('fetches canvas items for session', async () => {
        mockFetch.mockReturnValue(mockResponse([{ id: '1', type: 'markdown' }]));

        await client.getCanvasItems('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.any(Object));
      });
    });

    describe('uploadCanvasItem', () => {
      it('uploads file to canvas', async () => {
        const mockItem = { id: 'item-1', type: 'image', mimeType: 'image/png' };
        mockFetch.mockReturnValue(mockResponse(mockItem));

        const file = new File(['test content'], 'test.png', { type: 'image/png' });
        const result = await client.uploadCanvasItem('sess-123', file);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
          method: 'POST',
        }));
        // Check that FormData was used (not JSON)
        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1].body).toBeInstanceOf(FormData);
        expect(result).toEqual(mockItem);
      });

      it('includes label in FormData when provided', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'item-1' }));

        const file = new File(['test'], 'doc.pdf', { type: 'application/pdf' });
        await client.uploadCanvasItem('sess-123', file, 'My Document');

        const callArgs = mockFetch.mock.calls[0];
        const formData = callArgs[1].body;
        expect(formData.get('file')).toBeInstanceOf(File);
        expect(formData.get('label')).toBe('My Document');
      });

      it('does not include label in FormData when not provided', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'item-1' }));

        const file = new File(['test'], 'image.jpg', { type: 'image/jpeg' });
        await client.uploadCanvasItem('sess-123', file);

        const callArgs = mockFetch.mock.calls[0];
        const formData = callArgs[1].body;
        expect(formData.get('file')).toBeInstanceOf(File);
        expect(formData.get('label')).toBeNull();
      });

      it('throws error on upload failure', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
          ok: false,
          status: 413,
          json: () => Promise.resolve({ error: 'File too large' }),
        }));

        const file = new File(['large content'], 'big.zip', { type: 'application/zip' });
        await expect(client.uploadCanvasItem('sess-123', file)).rejects.toThrow('File too large');
      });

      it('throws HTTP status error when no error message in response', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('Parse error')),
        }));

        const file = new File(['test'], 'test.txt', { type: 'text/plain' });
        await expect(client.uploadCanvasItem('sess-123', file)).rejects.toThrow('HTTP 500');
      });
    });

    describe('createCanvasItem', () => {
      it('creates text canvas item with content', async () => {
        const itemData = {
          type: 'text',
          content: 'Command output here',
          label: 'Test output',
          filename: 'test-output.txt',
        };
        const mockItem = { id: 'item-1', ...itemData };
        mockFetch.mockReturnValue(mockResponse(mockItem));

        const result = await client.createCanvasItem('sess-123', itemData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(itemData),
        }));
        expect(result).toEqual(mockItem);
      });

      it('creates markdown canvas item', async () => {
        const itemData = {
          type: 'markdown',
          content: '# Title\n\nSome content',
          label: 'Markdown doc',
        };
        const mockItem = { id: 'item-2', ...itemData };
        mockFetch.mockReturnValue(mockResponse(mockItem));

        const result = await client.createCanvasItem('sess-123', itemData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(itemData),
        }));
        expect(result).toEqual(mockItem);
      });

      it('creates json canvas item', async () => {
        const itemData = {
          type: 'json',
          data: '{"key": "value"}',
          label: 'JSON data',
        };
        const mockItem = { id: 'item-3', ...itemData };
        mockFetch.mockReturnValue(mockResponse(mockItem));

        const result = await client.createCanvasItem('sess-123', itemData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(itemData),
        }));
        expect(result).toEqual(mockItem);
      });

      it('creates canvas item with minimal data', async () => {
        const itemData = {
          type: 'text',
          content: 'Simple text',
        };
        const mockItem = { id: 'item-4', ...itemData };
        mockFetch.mockReturnValue(mockResponse(mockItem));

        const result = await client.createCanvasItem('sess-123', itemData);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
          method: 'POST',
        }));
        expect(result).toEqual(mockItem);
      });

      it('throws error on creation failure', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Invalid type' }),
        }));

        const itemData = { type: 'invalid', content: 'test' };
        await expect(client.createCanvasItem('sess-123', itemData)).rejects.toThrow('Invalid type');
      });
    });

    describe('deleteCanvasItem', () => {
      it('deletes canvas item', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteCanvasItem('sess-123', 'item-456');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/item-456', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });
  });

  describe('git', () => {
    describe('getGitStatus', () => {
      it('fetches git status for project', async () => {
        mockFetch.mockReturnValue(mockResponse({ isRepo: true }));

        await client.getGitStatus('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/status', expect.any(Object));
      });
    });

    describe('getWorktrees', () => {
      it('fetches worktrees for project', async () => {
        mockFetch.mockReturnValue(mockResponse([{ path: '/tmp' }]));

        await client.getWorktrees('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/worktrees', expect.any(Object));
      });
    });
  });

  describe('notes', () => {
    describe('getSessionNotes', () => {
      it('fetches notes for session', async () => {
        mockFetch.mockReturnValue(mockResponse([{ id: '1', content: 'Note' }]));

        await client.getSessionNotes('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.any(Object));
      });
    });

    describe('createNote', () => {
      it('posts note content', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        await client.createNote('sess-123', 'New note');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'New note' }),
        }));
      });
    });

    describe('updateNote', () => {
      it('puts note content', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'note-456' }));

        await client.updateNote('sess-123', 'note-456', 'Updated');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-456', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ content: 'Updated' }),
        }));
      });
    });

    describe('deleteNote', () => {
      it('deletes note', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteNote('sess-123', 'note-456');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-456', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });
  });

  describe('error handling', () => {
    it('throws with error message from response', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad request' }),
      }));

      await expect(client.getProjects()).rejects.toThrow('Bad request');
    });

    it('throws with HTTP status when no error message', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      }));

      await expect(client.getProjects()).rejects.toThrow('HTTP 500');
    });

    it('returns null for 204 responses', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      const result = await client.deleteProject('123');

      expect(result).toBeNull();
    });
  });

  describe('request headers', () => {
    it('includes Content-Type header', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjects();

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }));
    });
  });

  describe('custom base URL', () => {
    it('uses custom base URL in requests', async () => {
      const customClient = new ApiClient('http://api.example.com');
      mockFetch.mockReturnValue(mockResponse([]));

      await customClient.getProjects();

      expect(mockFetch).toHaveBeenCalledWith('http://api.example.com/projects', expect.any(Object));
    });
  });

  describe('templates', () => {
    describe('getGlobalTemplates', () => {
      it('fetches from /api/templates', async () => {
        const mockData = [{ id: '1', name: 'Global Template' }];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getGlobalTemplates();

        expect(mockFetch).toHaveBeenCalledWith('/api/templates', expect.objectContaining({
          method: 'GET',
        }));
        expect(result).toEqual(mockData);
      });
    });

    describe('createGlobalTemplate', () => {
      it('posts to /api/templates', async () => {
        const templateData = { name: 'New Template', prompt: 'Do something' };
        const mockData = { id: '1', ...templateData };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.createGlobalTemplate(templateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/templates', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(templateData),
        }));
        expect(result).toEqual(mockData);
      });
    });

    describe('getTemplate', () => {
      it('fetches template by ID', async () => {
        const mockData = { id: 'tmpl-123', name: 'Test' };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getTemplate('tmpl-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-123', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('updateTemplate', () => {
      it('patches template by ID', async () => {
        const updateData = { name: 'Updated' };
        mockFetch.mockReturnValue(mockResponse({ id: 'tmpl-123', name: 'Updated' }));

        const result = await client.updateTemplate('tmpl-123', updateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-123', expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updateData),
        }));
        expect(result.name).toBe('Updated');
      });
    });

    describe('deleteTemplate', () => {
      it('deletes template by ID', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteTemplate('tmpl-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-123', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });

    describe('getProjectTemplates', () => {
      it('fetches templates for project', async () => {
        const mockData = { project: [{ id: '1' }], global: [{ id: '2' }] };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getProjectTemplates('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/templates', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('createProjectTemplate', () => {
      it('posts to project templates endpoint', async () => {
        const templateData = { name: 'Project Template', prompt: 'Do work' };
        const mockData = { id: '1', projectId: 'proj-123', ...templateData };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.createProjectTemplate('proj-123', templateData);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/templates', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(templateData),
        }));
        expect(result.projectId).toBe('proj-123');
      });
    });
  });

  describe('conversations', () => {
    describe('getConversations', () => {
      it('fetches conversations for session', async () => {
        const mockData = [
          { id: 'conv-1', name: 'First', isActive: true, messageCount: 5 },
          { id: 'conv-2', name: 'Second', isActive: false, messageCount: 3 },
        ];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getConversations('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('createConversation', () => {
      it('creates conversation with name', async () => {
        const mockData = { id: 'conv-new', name: 'My Conv', isActive: true };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.createConversation('sess-123', 'My Conv');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'My Conv' }),
        }));
        expect(result).toEqual(mockData);
      });

      it('creates conversation without name', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'conv-new', name: null }));

        await client.createConversation('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: null }),
        }));
      });
    });

    describe('getConversation', () => {
      it('fetches specific conversation', async () => {
        const mockData = { id: 'conv-1', name: 'Test', messageCount: 10 };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getConversation('sess-123', 'conv-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });

    describe('updateConversation', () => {
      it('updates conversation name', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'conv-1', name: 'Updated' }));

        await client.updateConversation('sess-123', 'conv-1', { name: 'Updated' });

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated' }),
        }));
      });

      it('updates conversation isActive', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'conv-1', isActive: true }));

        await client.updateConversation('sess-123', 'conv-1', { isActive: true });

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ isActive: true }),
        }));
      });
    });

    describe('deleteConversation', () => {
      it('deletes conversation', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteConversation('sess-123', 'conv-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });

    describe('generateConversationSummary', () => {
      it('generates summary for conversation', async () => {
        const mockData = { summary: 'This is a test summary' };
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.generateConversationSummary('sess-123', 'conv-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1/summary', expect.objectContaining({
          method: 'POST',
        }));
        expect(result).toEqual(mockData);
      });
    });

    describe('getConversationMessages', () => {
      it('fetches messages for conversation', async () => {
        const mockData = [
          { id: 'msg-1', content: 'Hello', role: 'user' },
          { id: 'msg-2', content: 'Hi there', role: 'assistant' },
        ];
        mockFetch.mockReturnValue(mockResponse(mockData));

        const result = await client.getConversationMessages('sess-123', 'conv-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/messages?conversation_id=conv-1', expect.any(Object));
        expect(result).toEqual(mockData);
      });
    });
  });
});
