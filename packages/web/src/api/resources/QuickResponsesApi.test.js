import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('QuickResponsesApi', () => {
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

  describe('getQuickResponses', () => {
    it('sends GET to /projects/:id/quick-responses', async () => {
      const data = { project: [{ id: '1' }], global: [{ id: '2' }] };
      mockFetch.mockReturnValue(mockResponse(data));

      const result = await client.getQuickResponses('proj-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/quick-responses', expect.any(Object));
      expect(result.project).toHaveLength(1);
    });
  });

  describe('getGlobalQuickResponses', () => {
    it('sends GET to /quick-responses/global', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: '1', label: 'LGTM' }]));

      const result = await client.getGlobalQuickResponses();

      expect(mockFetch).toHaveBeenCalledWith('/api/quick-responses/global', expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });

  describe('createQuickResponse', () => {
    it('sends POST to /projects/:id/quick-responses', async () => {
      const data = { label: 'Approve', content: 'Looks good!' };
      mockFetch.mockReturnValue(mockResponse({ id: 'qr-1', ...data }));

      await client.createQuickResponse('proj-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/quick-responses', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('updateQuickResponse', () => {
    it('sends PATCH to /quick-responses/:id', async () => {
      const data = { label: 'Updated' };
      mockFetch.mockReturnValue(mockResponse({ id: 'qr-1', ...data }));

      await client.updateQuickResponse('qr-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/quick-responses/qr-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('deleteQuickResponse', () => {
    it('sends DELETE to /quick-responses/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteQuickResponse('qr-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/quick-responses/qr-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('reorderQuickResponses', () => {
    it('sends POST to reorder endpoint with order array', async () => {
      const orders = [{ id: 'qr-1', sortOrder: 0 }, { id: 'qr-2', sortOrder: 1 }];
      mockFetch.mockReturnValue(mockResponse({ project: [], global: [] }));

      await client.reorderQuickResponses('proj-123', orders);

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-123/quick-responses/reorder', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(orders),
      }));
    });
  });

  describe('reorderGlobalQuickResponses', () => {
    it('sends POST to global reorder endpoint', async () => {
      const orders = [{ id: 'qr-1', sortOrder: 0 }];
      mockFetch.mockReturnValue(mockResponse([]));

      await client.reorderGlobalQuickResponses(orders);

      expect(mockFetch).toHaveBeenCalledWith('/api/quick-responses/global/reorder', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(orders),
      }));
    });
  });
});
