import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('CommandButtonsApi', () => {
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

  describe('getCommandButtons', () => {
    it('sends GET to /projects/:id/command-buttons', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: 'btn-1' }]));

      const result = await client.getCommandButtons('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons', expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });

  describe('createCommandButton', () => {
    it('sends POST to /projects/:id/command-buttons', async () => {
      const data = { label: 'Run Tests', command: 'yarn test' };
      mockFetch.mockReturnValue(mockResponse({ id: 'btn-1', ...data }));

      await client.createCommandButton('proj-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('getCommandButton', () => {
    it('sends GET to /projects/:id/command-buttons/:buttonId', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'btn-1', label: 'Build' }));

      const result = await client.getCommandButton('proj-123', 'btn-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons/btn-1', expect.any(Object));
      expect(result.label).toBe('Build');
    });
  });

  describe('updateCommandButton', () => {
    it('sends PATCH to /projects/:id/command-buttons/:buttonId', async () => {
      const data = { label: 'Updated' };
      mockFetch.mockReturnValue(mockResponse({ id: 'btn-1', ...data }));

      await client.updateCommandButton('proj-123', 'btn-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons/btn-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('deleteCommandButton', () => {
    it('sends DELETE to /projects/:id/command-buttons/:buttonId', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteCommandButton('proj-123', 'btn-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons/btn-1', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('runCommandButton', () => {
    it('sends POST to run endpoint', async () => {
      mockFetch.mockReturnValue(mockResponse({ runId: 'run-1' }));

      const result = await client.runCommandButton('sess-123', 'btn-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/command-buttons/btn-1/run', expect.objectContaining({
        method: 'POST',
      }));
      expect(result.runId).toBe('run-1');
    });
  });

  describe('getActiveRuns', () => {
    it('sends GET to /sessions/:id/command-buttons/runs', async () => {
      const runs = [
        { runId: 'run-1', status: 'running' },
        { runId: 'run-2', status: 'success' },
      ];
      mockFetch.mockReturnValue(mockResponse(runs));

      const result = await client.getActiveRuns('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/command-buttons/runs', expect.any(Object));
      expect(result).toHaveLength(2);
    });
  });

  describe('getCommandRun', () => {
    it('sends GET to /sessions/:id/command-buttons/runs/:runId', async () => {
      const run = { runId: 'run-1', status: 'success', exitCode: 0 };
      mockFetch.mockReturnValue(mockResponse(run));

      const result = await client.getCommandRun('sess-123', 'run-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/command-buttons/runs/run-1', expect.any(Object));
      expect(result.status).toBe('success');
    });

    it('handles 404 for non-existent run', async () => {
      mockFetch.mockReturnValue(mockResponse({ error: 'Run not found' }, { ok: false, status: 404 }));

      await expect(client.getCommandRun('sess-123', 'nonexistent')).rejects.toThrow('Run not found');
    });
  });

  describe('getLatestRunsForProject', () => {
    it('sends GET to /projects/:id/command-buttons/latest-runs', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getLatestRunsForProject('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/command-buttons/latest-runs', expect.any(Object));
    });
  });

  describe('killCommandRun', () => {
    it('sends POST to kill endpoint', async () => {
      mockFetch.mockReturnValue(mockResponse({ success: true }));

      const result = await client.killCommandRun('sess-123', 'run-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/command-buttons/runs/run-1/kill', expect.objectContaining({
        method: 'POST',
      }));
      expect(result.success).toBe(true);
    });
  });
});
