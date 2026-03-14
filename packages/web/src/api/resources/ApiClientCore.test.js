import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('ApiClient Core', () => {
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

  describe('_buildQueryPath', () => {
    it('returns base path with no params when all values undefined', () => {
      const result = client._buildQueryPath('/test', { a: undefined, b: undefined });
      expect(result).toBe('/test');
    });

    it('returns base path with no params when all values null', () => {
      const result = client._buildQueryPath('/test', { a: null, b: null });
      expect(result).toBe('/test');
    });

    it('returns base path when params object is empty', () => {
      const result = client._buildQueryPath('/test', {});
      expect(result).toBe('/test');
    });

    it('appends single param', () => {
      const result = client._buildQueryPath('/test', { key: 'value' });
      expect(result).toBe('/test?key=value');
    });

    it('appends multiple params', () => {
      const result = client._buildQueryPath('/test', { a: '1', b: '2' });
      expect(result).toBe('/test?a=1&b=2');
    });

    it('filters out undefined values among defined values', () => {
      const result = client._buildQueryPath('/test', { a: '1', b: undefined, c: '3' });
      expect(result).toBe('/test?a=1&c=3');
    });

    it('handles boolean values', () => {
      const result = client._buildQueryPath('/test', { flag: true });
      expect(result).toBe('/test?flag=true');
    });

    it('handles numeric values', () => {
      const result = client._buildQueryPath('/test', { limit: 10, offset: 0 });
      expect(result).toBe('/test?limit=10&offset=0');
    });

    it('encodes special characters', () => {
      const result = client._buildQueryPath('/test', { path: '/some/path with spaces' });
      expect(result).toContain('path=');
      // URLSearchParams encodes spaces as +
      expect(result).toBe('/test?path=%2Fsome%2Fpath+with+spaces');
    });
  });

  describe('_uploadFormData', () => {
    it('sends POST with FormData body', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: '1' }));
      const formData = new FormData();
      formData.append('file', 'test');

      await client._uploadFormData('/upload', formData);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('/api/upload');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].body).toBe(formData);
      // Should NOT set Content-Type header (browser sets it with boundary)
      expect(callArgs[1].headers).toBeUndefined();
    });

    it('throws with error message from response', async () => {
      mockFetch.mockReturnValue(mockResponse({ error: 'File too large' }, { ok: false, status: 413 }));
      const formData = new FormData();

      await expect(client._uploadFormData('/upload', formData)).rejects.toThrow('File too large');
    });

    it('throws HTTP status when response JSON parse fails', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      }));
      const formData = new FormData();

      await expect(client._uploadFormData('/upload', formData)).rejects.toThrow('HTTP 500');
    });
  });

  describe('Mixin composition', () => {
    it('has all resource methods from ProjectsApi', () => {
      expect(typeof client.getProjects).toBe('function');
      expect(typeof client.getProject).toBe('function');
      expect(typeof client.createProject).toBe('function');
      expect(typeof client.updateProject).toBe('function');
      expect(typeof client.deleteProject).toBe('function');
    });

    it('has all resource methods from SessionsApi', () => {
      expect(typeof client.getActiveSessions).toBe('function');
      expect(typeof client.getSession).toBe('function');
      expect(typeof client.createSession).toBe('function');
      expect(typeof client.sendMessage).toBe('function');
      expect(typeof client.stopSession).toBe('function');
      expect(typeof client.archiveSession).toBe('function');
      expect(typeof client.duplicateSession).toBe('function');
    });

    it('has all resource methods from CanvasApi', () => {
      expect(typeof client.getCanvasItems).toBe('function');
      expect(typeof client.uploadCanvasItem).toBe('function');
      expect(typeof client.createCanvasItem).toBe('function');
      expect(typeof client.deleteCanvasItem).toBe('function');
      expect(typeof client.bulkDeleteCanvasItems).toBe('function');
    });

    it('has all resource methods from ProvidersApi', () => {
      expect(typeof client.getProviders).toBe('function');
      expect(typeof client.createProvider).toBe('function');
      expect(typeof client.testProviderConnection).toBe('function');
      expect(typeof client.getProviderModels).toBe('function');
    });

    it('has all resource methods from CommandButtonsApi', () => {
      expect(typeof client.getCommandButtons).toBe('function');
      expect(typeof client.runCommandButton).toBe('function');
      expect(typeof client.getActiveRuns).toBe('function');
      expect(typeof client.killCommandRun).toBe('function');
    });

    it('has all resource methods from SettingsApi', () => {
      expect(typeof client.getTokenCostWeights).toBe('function');
      expect(typeof client.getSummarySettings).toBe('function');
      expect(typeof client.getGeneralSettings).toBe('function');
    });

    it('has all resource methods from ConversationsApi', () => {
      expect(typeof client.getConversations).toBe('function');
      expect(typeof client.createConversation).toBe('function');
      expect(typeof client.branchConversation).toBe('function');
    });

    it('has all resource methods from TemplatesApi', () => {
      expect(typeof client.getGlobalTemplates).toBe('function');
      expect(typeof client.getProjectTemplates).toBe('function');
    });

    it('has all resource methods from QuickResponsesApi', () => {
      expect(typeof client.getQuickResponses).toBe('function');
      expect(typeof client.reorderQuickResponses).toBe('function');
    });

    it('has all resource methods from MiscApi', () => {
      expect(typeof client.getGitStatus).toBe('function');
      expect(typeof client.getSessionTodos).toBe('function');
      expect(typeof client.getSessionSummary).toBe('function');
      expect(typeof client.browseDirectory).toBe('function');
      expect(typeof client.getSlashCommands).toBe('function');
      expect(typeof client.getAgentCallLogs).toBe('function');
      expect(typeof client.getProjectSessionDefaults).toBe('function');
    });
  });

  describe('#request error handling', () => {
    it('throws with error message from response body', async () => {
      mockFetch.mockReturnValue(mockResponse({ error: 'Bad request' }, { ok: false, status: 400 }));

      await expect(client._get('/test')).rejects.toThrow('Bad request');
    });

    it('throws with HTTP status when response has no error message', async () => {
      mockFetch.mockReturnValue(Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      }));

      await expect(client._get('/test')).rejects.toThrow('HTTP 500');
    });

    it('returns null for 204 responses', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      const result = await client._delete('/test');

      expect(result).toBeNull();
    });
  });

  describe('#request headers', () => {
    it('includes Content-Type: application/json', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client._get('/test');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    it('does not include body for GET requests even with data', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client._get('/test');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeUndefined();
    });
  });

  describe('custom base URL', () => {
    it('prepends custom base URL to all requests', async () => {
      const customClient = new ApiClient('http://api.example.com');
      mockFetch.mockReturnValue(mockResponse([]));

      await customClient.getProjects();

      expect(mockFetch).toHaveBeenCalledWith('http://api.example.com/projects', expect.any(Object));
    });
  });
});
