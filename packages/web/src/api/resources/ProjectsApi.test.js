import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('ProjectsApi', () => {
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

  describe('getProjects', () => {
    it('sends GET to /projects', async () => {
      const mockData = [{ id: '1', name: 'Test' }];
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await client.getProjects();

      expect(mockFetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
        method: 'GET',
      }));
      expect(result).toEqual(mockData);
    });

    it('returns empty array when no projects', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      const result = await client.getProjects();

      expect(result).toEqual([]);
    });
  });

  describe('getProject', () => {
    it('sends GET to /projects/:id', async () => {
      const mockData = { id: '123', name: 'Test' };
      mockFetch.mockReturnValue(mockResponse(mockData));

      const result = await client.getProject('123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
        method: 'GET',
      }));
      expect(result).toEqual(mockData);
    });

    it('handles 404 for non-existent project', async () => {
      mockFetch.mockReturnValue(mockResponse({ error: 'Project not found' }, { ok: false, status: 404 }));

      await expect(client.getProject('nonexistent')).rejects.toThrow('Project not found');
    });
  });

  describe('createProject', () => {
    it('sends POST to /projects with body', async () => {
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
    it('sends PUT to /projects/:id with body', async () => {
      const updateData = { name: 'Updated' };
      mockFetch.mockReturnValue(mockResponse({ id: '123', ...updateData }));

      const result = await client.updateProject('123', updateData);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(updateData),
      }));
      expect(result.name).toBe('Updated');
    });
  });

  describe('deleteProject', () => {
    it('sends DELETE to /projects/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      const result = await client.deleteProject('123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/123', expect.objectContaining({
        method: 'DELETE',
      }));
      expect(result).toBeNull();
    });
  });
});
