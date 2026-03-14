import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('TemplatesApi', () => {
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

  describe('getGlobalTemplates', () => {
    it('sends GET to /templates', async () => {
      const templates = [{ id: '1', name: 'Global' }];
      mockFetch.mockReturnValue(mockResponse(templates));

      const result = await client.getGlobalTemplates();

      expect(mockFetch).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'GET' }));
      expect(result).toEqual(templates);
    });
  });

  describe('createGlobalTemplate', () => {
    it('sends POST to /templates', async () => {
      const data = { name: 'New', prompt: 'Do something' };
      mockFetch.mockReturnValue(mockResponse({ id: '1', ...data }));

      await client.createGlobalTemplate(data);

      expect(mockFetch).toHaveBeenCalledWith('/api/templates', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('getTemplate', () => {
    it('sends GET to /templates/:id', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'tmpl-1', name: 'Test' }));

      const result = await client.getTemplate('tmpl-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-1', expect.any(Object));
      expect(result.name).toBe('Test');
    });
  });

  describe('updateTemplate', () => {
    it('sends PATCH to /templates/:id', async () => {
      const data = { name: 'Updated' };
      mockFetch.mockReturnValue(mockResponse({ id: 'tmpl-1', ...data }));

      await client.updateTemplate('tmpl-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('deleteTemplate', () => {
    it('sends DELETE to /templates/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteTemplate('tmpl-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/templates/tmpl-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('getProjectTemplates', () => {
    it('sends GET to /projects/:id/templates', async () => {
      const data = { project: [{ id: '1' }], global: [{ id: '2' }] };
      mockFetch.mockReturnValue(mockResponse(data));

      const result = await client.getProjectTemplates('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/templates', expect.any(Object));
      expect(result.project).toHaveLength(1);
      expect(result.global).toHaveLength(1);
    });
  });

  describe('createProjectTemplate', () => {
    it('sends POST to /projects/:id/templates', async () => {
      const data = { name: 'Project Template', prompt: 'Do work' };
      mockFetch.mockReturnValue(mockResponse({ id: '1', projectId: 'proj-123', ...data }));

      const result = await client.createProjectTemplate('proj-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/templates', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
      expect(result.projectId).toBe('proj-123');
    });
  });
});
