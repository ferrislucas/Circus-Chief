import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('MiscApi', () => {
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

  describe('Git', () => {
    describe('getGitStatus', () => {
      it('sends GET to /git/projects/:id/status', async () => {
        mockFetch.mockReturnValue(mockResponse({ isRepo: true }));

        const result = await client.getGitStatus('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/status', expect.any(Object));
        expect(result.isRepo).toBe(true);
      });
    });

    describe('getWorktrees', () => {
      it('sends GET to /git/projects/:id/worktrees', async () => {
        mockFetch.mockReturnValue(mockResponse([{ path: '/tmp/wt' }]));

        const result = await client.getWorktrees('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/git/projects/proj-123/worktrees', expect.any(Object));
        expect(result).toHaveLength(1);
      });
    });
  });

  describe('Todos', () => {
    describe('getSessionTodos', () => {
      it('sends GET without conversation_id when omitted', async () => {
        mockFetch.mockReturnValue(mockResponse([]));

        await client.getSessionTodos('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/todos', expect.any(Object));
      });

      it('appends conversation_id query parameter when provided', async () => {
        mockFetch.mockReturnValue(mockResponse([]));

        await client.getSessionTodos('sess-123', 'conv-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/todos?conversation_id=conv-1', expect.any(Object));
      });
    });
  });

  describe('Summaries', () => {
    describe('getSessionSummary', () => {
      it('sends GET to /sessions/:id/summary without generate param by default', async () => {
        mockFetch.mockReturnValue(mockResponse({ title: 'Test', summary: 'A summary' }));

        await client.getSessionSummary('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/summary', expect.any(Object));
      });

      it('includes generate=true when requested', async () => {
        mockFetch.mockReturnValue(mockResponse({ title: 'Test' }));

        await client.getSessionSummary('sess-123', true);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/summary?generate=true', expect.any(Object));
      });

      it('returns null for 404 errors', async () => {
        mockFetch.mockReturnValue(mockResponse({ error: 'not found' }, { ok: false, status: 404 }));

        const result = await client.getSessionSummary('sess-123');

        expect(result).toBeNull();
      });

      it('rethrows non-404 errors', async () => {
        mockFetch.mockReturnValue(mockResponse({ error: 'Server error' }, { ok: false, status: 500 }));

        await expect(client.getSessionSummary('sess-123')).rejects.toThrow('Server error');
      });
    });

    describe('getSessionSummariesBatch', () => {
      it('sends POST with session IDs', async () => {
        mockFetch.mockReturnValue(mockResponse({ 'sess-1': { title: 'Test' }, 'sess-2': null }));

        const result = await client.getSessionSummariesBatch(['sess-1', 'sess-2']);

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/summaries/batch', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ids: ['sess-1', 'sess-2'] }),
        }));
        expect(result).toHaveProperty('sess-1');
      });

      it('returns empty object for empty or null ids', async () => {
        expect(await client.getSessionSummariesBatch([])).toEqual({});
        expect(await client.getSessionSummariesBatch(null)).toEqual({});
      });
    });

    describe('generateSessionSummary', () => {
      it('sends POST to /sessions/:id/summary', async () => {
        mockFetch.mockReturnValue(mockResponse({ title: 'Generated' }));

        await client.generateSessionSummary('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/summary', expect.objectContaining({ method: 'POST' }));
      });
    });
  });

  describe('Notes', () => {
    describe('getSessionNotes', () => {
      it('sends GET to /sessions/:id/notes', async () => {
        mockFetch.mockReturnValue(mockResponse([{ id: '1', content: 'Note' }]));

        await client.getSessionNotes('sess-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.any(Object));
      });
    });

    describe('createNote', () => {
      it('sends POST with content', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: '1' }));

        await client.createNote('sess-123', 'New note');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'New note' }),
        }));
      });
    });

    describe('updateNote', () => {
      it('sends PUT with content', async () => {
        mockFetch.mockReturnValue(mockResponse({ id: 'note-1' }));

        await client.updateNote('sess-123', 'note-1', 'Updated');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-1', expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ content: 'Updated' }),
        }));
      });
    });

    describe('deleteNote', () => {
      it('sends DELETE to /sessions/:id/notes/:noteId', async () => {
        mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

        await client.deleteNote('sess-123', 'note-1');

        expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/notes/note-1', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });
  });

  describe('Filesystem', () => {
    describe('browseDirectory', () => {
      it('sends GET without path when empty', async () => {
        mockFetch.mockReturnValue(mockResponse({ path: '/home', entries: [] }));

        await client.browseDirectory();

        expect(mockFetch).toHaveBeenCalledWith('/api/filesystem/browse', expect.any(Object));
      });

      it('includes path query parameter when provided', async () => {
        mockFetch.mockReturnValue(mockResponse({ path: '/tmp', entries: [] }));

        await client.browseDirectory('/tmp');

        expect(mockFetch).toHaveBeenCalledWith('/api/filesystem/browse?path=%2Ftmp', expect.any(Object));
      });
    });
  });

  describe('Slash Commands', () => {
    describe('getSlashCommands', () => {
      it('sends GET with encoded directory', async () => {
        mockFetch.mockReturnValue(mockResponse([]));

        await client.getSlashCommands('/home/user/project');

        expect(mockFetch).toHaveBeenCalledWith('/api/commands?directory=%2Fhome%2Fuser%2Fproject', expect.any(Object));
      });
    });

    describe('getSlashCommand', () => {
      it('sends GET with encoded name and directory', async () => {
        mockFetch.mockReturnValue(mockResponse({ name: 'deploy' }));

        await client.getSlashCommand('/home/user', 'deploy');

        expect(mockFetch).toHaveBeenCalledWith('/api/commands/deploy?directory=%2Fhome%2Fuser', expect.any(Object));
      });
    });

    describe('executeSlashCommand', () => {
      it('sends POST with sessionId and args', async () => {
        mockFetch.mockReturnValue(mockResponse({ result: 'ok' }));

        await client.executeSlashCommand('sess-123', 'deploy', { env: 'prod' });

        expect(mockFetch).toHaveBeenCalledWith('/api/commands/deploy/execute', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sessionId: 'sess-123', args: { env: 'prod' } }),
        }));
      });

      it('defaults args to empty object', async () => {
        mockFetch.mockReturnValue(mockResponse({ result: 'ok' }));

        await client.executeSlashCommand('sess-123', 'build');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.args).toEqual({});
      });
    });
  });

  describe('Agent Call Logs', () => {
    describe('getAgentCallLogs', () => {
      it('sends GET without params when no filters', async () => {
        mockFetch.mockReturnValue(mockResponse({ logs: [], pagination: {} }));

        await client.getAgentCallLogs();

        expect(mockFetch).toHaveBeenCalledWith('/api/agent-calls', expect.any(Object));
      });

      it('includes all filter params when provided', async () => {
        mockFetch.mockReturnValue(mockResponse({ logs: [], pagination: {} }));

        await client.getAgentCallLogs({
          limit: 10,
          offset: 20,
          agentType: 'summary',
          status: 'success',
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });

        const url = mockFetch.mock.calls[0][0];
        expect(url).toContain('limit=10');
        expect(url).toContain('offset=20');
        expect(url).toContain('agentType=summary');
        expect(url).toContain('status=success');
        expect(url).toContain('sortBy=createdAt');
        expect(url).toContain('sortOrder=desc');
      });
    });

    describe('getAgentCallFilterOptions', () => {
      it('sends GET to /agent-calls/filter-options', async () => {
        mockFetch.mockReturnValue(mockResponse({ agentTypes: [], callTypes: [], statuses: [], models: [] }));

        await client.getAgentCallFilterOptions();

        expect(mockFetch).toHaveBeenCalledWith('/api/agent-calls/filter-options', expect.any(Object));
      });
    });

    describe('deleteAllAgentCallLogs', () => {
      it('sends DELETE to /agent-calls', async () => {
        mockFetch.mockReturnValue(mockResponse({ success: true, deleted: 5 }));

        const result = await client.deleteAllAgentCallLogs();

        expect(mockFetch).toHaveBeenCalledWith('/api/agent-calls', expect.objectContaining({ method: 'DELETE' }));
        expect(result.deleted).toBe(5);
      });
    });
  });

  describe('Project Session Defaults', () => {
    describe('getProjectSessionDefaults', () => {
      it('sends GET to /projects/:id/session-defaults', async () => {
        mockFetch.mockReturnValue(mockResponse({ thinkingEnabled: true }));

        const result = await client.getProjectSessionDefaults('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/session-defaults', expect.any(Object));
        expect(result.thinkingEnabled).toBe(true);
      });
    });

    describe('updateProjectSessionDefaults', () => {
      it('sends POST to /projects/:id/session-defaults', async () => {
        const data = { thinkingEnabled: false, model: 'claude-sonnet-4-20250514' };
        mockFetch.mockReturnValue(mockResponse(data));

        await client.updateProjectSessionDefaults('proj-123', data);

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/session-defaults', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(data),
        }));
      });
    });

    describe('resetProjectSessionDefaults', () => {
      it('sends DELETE to /projects/:id/session-defaults', async () => {
        mockFetch.mockReturnValue(mockResponse({}));

        await client.resetProjectSessionDefaults('proj-123');

        expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/session-defaults', expect.objectContaining({
          method: 'DELETE',
        }));
      });
    });
  });
});
