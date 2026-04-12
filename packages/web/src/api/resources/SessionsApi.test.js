import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('SessionsApi', () => {
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

  const mockResponse = (data, options = {}) => Promise.resolve({
      ok: options.ok !== undefined ? options.ok : true,
      status: options.status || 200,
      json: () => Promise.resolve(data),
    });

  describe('getActiveSessions', () => {
    it('sends GET to /sessions', async () => {
      const mockData = [{ id: '1', status: 'running' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await client.getActiveSessions();

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'GET' }));
      expect(result).toEqual(mockData);
    });
  });

  describe('getScheduledSessions', () => {
    it('fetches all scheduled sessions without project filter', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getScheduledSessions();

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/scheduled', expect.any(Object));
    });

    it('appends projectId query parameter when provided', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getScheduledSessions('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/scheduled?projectId=proj-123', expect.any(Object));
    });

    it('omits projectId when null', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getScheduledSessions(null);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe('/api/sessions/scheduled');
    });
  });

  describe('getProjectSessions', () => {
    it('fetches sessions for project without filters', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjectSessions('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.any(Object));
    });

    it('includes archived=true filter', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjectSessions('proj-123', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?archived=true', expect.any(Object));
    });

    it('includes archived=false filter', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjectSessions('proj-123', false);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?archived=false', expect.any(Object));
    });

    it('includes starred filter', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjectSessions('proj-123', null, 'starred');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?starred=true', expect.any(Object));
    });

    it('includes unstarred filter', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getProjectSessions('proj-123', null, 'unstarred');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?starred=false', expect.any(Object));
    });

    it('includes pagination parameters', async () => {
      mockFetch.mockReturnValue(mockResponse({ sessions: [], pagination: {} }));

      await client.getProjectSessions('proj-123', null, null, { limit: 10, offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?limit=10&offset=20', expect.any(Object));
    });

    it('combines archived and pagination parameters', async () => {
      mockFetch.mockReturnValue(mockResponse({ sessions: [], pagination: {} }));

      await client.getProjectSessions('proj-123', true, null, { limit: 5, offset: 0 });

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions?archived=true&limit=5&offset=0', expect.any(Object));
    });
  });

  describe('createSession', () => {
    it('sends POST with JSON when no files', async () => {
      const data = { prompt: 'Hello', name: 'Test' };
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));

      await client.createSession('proj-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });

    it('sends FormData when files are attached', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });

      await client.createSession('proj-123', { prompt: 'Hello', files: [file] });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeInstanceOf(FormData);
      expect(callArgs[1].body.get('prompt')).toBe('Hello');
      expect(callArgs[1].body.getAll('files')).toHaveLength(1);
    });

    it('sends JSON when files array is empty', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));

      await client.createSession('proj-123', { prompt: 'Hello', files: [] });

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'Hello' }),
      }));
    });

    it('includes optional fields in FormData', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });

      await client.createSession('proj-123', {
        prompt: 'Hello',
        mode: 'standard',
        model: 'claude-sonnet-4-20250514',
        thinkingEnabled: true,
        startImmediately: false,
        gitBranch: 'feature',
        gitMode: 'branch',
        templateId: 'tmpl-1',
        files: [file],
      });

      const formData = mockFetch.mock.calls[0][1].body;
      expect(formData.get('mode')).toBe('standard');
      expect(formData.get('model')).toBe('claude-sonnet-4-20250514');
      expect(formData.get('thinkingEnabled')).toBe('true');
      expect(formData.get('startImmediately')).toBe('false');
      expect(formData.get('gitBranch')).toBe('feature');
      expect(formData.get('gitMode')).toBe('branch');
      expect(formData.get('templateId')).toBe('tmpl-1');
    });
  });

  describe('getSession', () => {
    it('sends GET to /sessions/:id', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123' }));

      const result = await client.getSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.any(Object));
      expect(result.id).toBe('sess-123');
    });
  });

  describe('getSessionMessages', () => {
    it('sends GET to /sessions/:id/messages', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: 'msg-1' }]));

      await client.getSessionMessages('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/messages', expect.any(Object));
    });
  });

  describe('getSessionWorkLogs', () => {
    it('sends GET to /sessions/:id/work-logs', async () => {
      mockFetch.mockReturnValue(mockResponse({}));

      await client.getSessionWorkLogs('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/work-logs', expect.any(Object));
    });
  });

  describe('sendMessage', () => {
    it('sends POST with JSON when no files', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));

      await client.sendMessage('sess-123', 'Hello');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/message', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Hello', model: null }),
      }));
    });

    it('sends FormData when files attached', async () => {
      mockFetch.mockReturnValue(mockResponse({ success: true }));
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });

      await client.sendMessage('sess-123', 'Hello', [file]);

      const formData = mockFetch.mock.calls[0][1].body;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('content')).toBe('Hello');
    });

    it('includes model in FormData when provided', async () => {
      mockFetch.mockReturnValue(mockResponse({ success: true }));
      const file = new File(['test'], 'test.txt', { type: 'text/plain' });

      await client.sendMessage('sess-123', 'Hello', [file], 'claude-opus-4-6');

      const formData = mockFetch.mock.calls[0][1].body;
      expect(formData.get('model')).toBe('claude-opus-4-6');
    });

    it('includes model in JSON body', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));

      await client.sendMessage('sess-123', 'Hello', [], 'claude-opus-4-6');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/message', expect.objectContaining({
        body: JSON.stringify({ content: 'Hello', model: 'claude-opus-4-6' }),
      }));
    });
  });

  describe('stopSession', () => {
    it('sends POST to /sessions/:id/stop', async () => {
      mockFetch.mockReturnValue(mockResponse({ status: 'stopped' }));

      await client.stopSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/stop', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('getSessionChanges', () => {
    it('sends GET without query params for local mode', async () => {
      mockFetch.mockReturnValue(mockResponse({ staged: '', unstaged: '', untracked: '' }));

      await client.getSessionChanges('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/changes', expect.any(Object));
    });

    it('sends compareMode and branch params for branch mode', async () => {
      mockFetch.mockReturnValue(mockResponse({ staged: '', unstaged: '', untracked: '' }));

      await client.getSessionChanges('sess-123', 'branch', 'main');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/changes?compareMode=branch&branch=main', expect.any(Object));
    });

    it('sends only compareMode when branch is null', async () => {
      mockFetch.mockReturnValue(mockResponse({ staged: '', unstaged: '', untracked: '' }));

      await client.getSessionChanges('sess-123', 'branch', null);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/changes?compareMode=branch', expect.any(Object));
    });
  });

  describe('getSessionDefaultBranch', () => {
    it('sends GET to /sessions/:id/default-branch', async () => {
      mockFetch.mockReturnValue(mockResponse({ branch: 'main' }));

      const result = await client.getSessionDefaultBranch('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/default-branch', expect.any(Object));
      expect(result.branch).toBe('main');
    });
  });

  describe('getSessionFilesCount', () => {
    it('sends GET to /sessions/:id/files-count', async () => {
      mockFetch.mockReturnValue(mockResponse({ count: 5 }));

      const result = await client.getSessionFilesCount('sess-123');

      expect(result.count).toBe(5);
    });
  });

  describe('getSessionFile', () => {
    it('encodes file path in URL', async () => {
      mockFetch.mockReturnValue(mockResponse({ data: 'base64', mimeType: 'image/png', filename: 'test.png' }));

      await client.getSessionFile('sess-123', 'images/screenshot.png');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/file?path=images%2Fscreenshot.png', expect.any(Object));
    });
  });

  describe('restartSession', () => {
    it('sends POST to /sessions/:id/restart', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', status: 'starting' }));

      await client.restartSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/restart', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('startSession', () => {
    it('sends POST without body when no prompt or model', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', status: 'starting' }));

      await client.startSession('sess-123');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeUndefined();
    });

    it('sends POST with prompt in body', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', status: 'starting' }));

      await client.startSession('sess-123', 'Go!');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toBe('Go!');
    });

    it('sends POST with model in body', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', status: 'starting' }));

      await client.startSession('sess-123', undefined, 'claude-opus-4-6');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-opus-4-6');
      expect(body.prompt).toBeUndefined();
    });

    it('sends POST with both prompt and model', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', status: 'starting' }));

      await client.startSession('sess-123', 'Go!', 'claude-opus-4-6');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toBe('Go!');
      expect(body.model).toBe('claude-opus-4-6');
    });
  });

  describe('updateSessionInitialPrompt', () => {
    it('sends PUT to /sessions/:id/initial-prompt', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'msg-1' }));

      await client.updateSessionInitialPrompt('sess-123', 'New prompt');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/initial-prompt', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ prompt: 'New prompt' }),
      }));
    });
  });

  describe('updateSession', () => {
    it('sends PATCH to /sessions/:id', async () => {
      const data = { thinkingEnabled: true };
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', ...data }));

      await client.updateSession('sess-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('updateSessionPendingPrompt', () => {
    it('sends PATCH to /sessions/:id/pending-prompt', async () => {
      mockFetch.mockReturnValue(mockResponse({}));

      await client.updateSessionPendingPrompt('sess-123', 'draft text');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/pending-prompt', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ pendingPrompt: 'draft text' }),
      }));
    });
  });

  describe('deleteSession', () => {
    it('sends DELETE to /sessions/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('archiveSession', () => {
    it('sends POST to /sessions/:id/archive with cleanup: false by default', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', archived: true }));

      const result = await client.archiveSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/archive', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cleanup: false }),
      }));
      expect(result.archived).toBe(true);
    });

    it('sends POST with cleanup: true when option is provided', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', archived: true }));

      const result = await client.archiveSession('sess-123', { cleanup: true });

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/archive', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cleanup: true }),
      }));
      expect(result.archived).toBe(true);
    });
  });

  describe('unarchiveSession', () => {
    it('sends POST to /sessions/:id/unarchive', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', archived: false }));

      const result = await client.unarchiveSession('sess-123');

      expect(result.archived).toBe(false);
    });
  });

  describe('toggleSessionStar', () => {
    it('sends POST to /sessions/:id/star', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123', starred: true }));

      const result = await client.toggleSessionStar('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/star', expect.objectContaining({ method: 'POST' }));
      expect(result.starred).toBe(true);
    });
  });

  describe('duplicateSession', () => {
    it('sends POST to /sessions/:id/duplicate', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'new-sess' }));

      const result = await client.duplicateSession('sess-123', { name: 'Copy' });

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/duplicate', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Copy' }),
      }));
      expect(result.id).toBe('new-sess');
    });

    it('uses empty options by default', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'new-sess' }));

      await client.duplicateSession('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/duplicate', expect.objectContaining({
        body: JSON.stringify({}),
      }));
    });
  });

  describe('scheduleSession', () => {
    it('sends POST to /sessions/:id/schedule', async () => {
      const scheduleData = { scheduledAt: Date.now() + 60000, prompt: 'Follow up' };
      mockFetch.mockReturnValue(mockResponse({ id: 'sess-123' }));

      await client.scheduleSession('sess-123', scheduleData);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/schedule', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(scheduleData),
      }));
    });
  });
});
