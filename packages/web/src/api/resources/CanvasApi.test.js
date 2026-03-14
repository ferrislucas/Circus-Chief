import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('CanvasApi', () => {
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

  describe('getCanvasItems', () => {
    it('sends GET to /sessions/:id/canvas', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: '1', type: 'markdown' }]));

      const result = await client.getCanvasItems('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });

  describe('getCanvasFileContent', () => {
    it('sends GET with encoded filename', async () => {
      mockFetch.mockReturnValue(mockResponse({ content: '# Hello', type: 'markdown' }));

      await client.getCanvasFileContent('sess-123', 'my doc.md');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/file/my%20doc.md/content', expect.any(Object));
    });
  });

  describe('getAllCanvasItems', () => {
    it('sends GET to /sessions/:id/canvas/all', async () => {
      const items = [
        { id: '1', filename: 'doc.md', createdAt: 1000 },
        { id: '2', filename: 'doc.md', createdAt: 2000 },
      ];
      mockFetch.mockReturnValue(mockResponse(items));

      const result = await client.getAllCanvasItems('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/all', expect.any(Object));
      expect(result).toHaveLength(2);
    });
  });

  describe('uploadCanvasItem', () => {
    it('sends FormData with file', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'item-1', type: 'image' }));
      const file = new File(['test'], 'image.png', { type: 'image/png' });

      const result = await client.uploadCanvasItem('sess-123', file);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('/api/sessions/sess-123/canvas');
      expect(callArgs[1].body).toBeInstanceOf(FormData);
      expect(callArgs[1].body.get('file')).toBeTruthy();
      expect(result.type).toBe('image');
    });

    it('throws on upload failure', async () => {
      mockFetch.mockReturnValue(mockResponse({ error: 'File too large' }, { ok: false, status: 413 }));
      const file = new File(['big'], 'big.zip', { type: 'application/zip' });

      await expect(client.uploadCanvasItem('sess-123', file)).rejects.toThrow('File too large');
    });
  });

  describe('createCanvasItem', () => {
    it('sends POST with JSON content', async () => {
      const data = { type: 'text', content: 'Hello', filename: 'note.txt' };
      mockFetch.mockReturnValue(mockResponse({ id: 'item-1', ...data }));

      const result = await client.createCanvasItem('sess-123', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
      expect(result.type).toBe('text');
    });
  });

  describe('deleteCanvasItem', () => {
    it('sends DELETE to /sessions/:id/canvas/:itemId', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteCanvasItem('sess-123', 'item-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/item-456', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('getCanvasTrash', () => {
    it('sends GET to /sessions/:id/canvas-trash', async () => {
      mockFetch.mockReturnValue(mockResponse([]));

      await client.getCanvasTrash('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas-trash', expect.any(Object));
    });
  });

  describe('recoverCanvasItem', () => {
    it('sends POST to recover endpoint', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'item-1' }));

      await client.recoverCanvasItem('sess-123', 'item-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/item-1/recover', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('recoverCanvasFile', () => {
    it('sends POST with encoded filename', async () => {
      mockFetch.mockReturnValue(mockResponse({ recovered: 2 }));

      await client.recoverCanvasFile('sess-123', 'my doc.md');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas-trash/recover-file/my%20doc.md', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('permanentlyDeleteCanvasItem', () => {
    it('sends DELETE to permanent endpoint', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.permanentlyDeleteCanvasItem('sess-123', 'item-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/item-1/permanent', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('bulkDeleteCanvasItems', () => {
    it('sends POST with itemIds array', async () => {
      mockFetch.mockReturnValue(mockResponse({ deletedCount: 3 }));

      const result = await client.bulkDeleteCanvasItems('sess-123', ['a', 'b', 'c']);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/bulk-delete', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ itemIds: ['a', 'b', 'c'] }),
      }));
      expect(result.deletedCount).toBe(3);
    });
  });

  describe('bulkRecoverCanvasItems', () => {
    it('sends POST with itemIds array', async () => {
      mockFetch.mockReturnValue(mockResponse({ recoveredCount: 2 }));

      const result = await client.bulkRecoverCanvasItems('sess-123', ['a', 'b']);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/bulk-recover', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ itemIds: ['a', 'b'] }),
      }));
      expect(result.recoveredCount).toBe(2);
    });
  });

  describe('bulkPermanentlyDeleteCanvasItems', () => {
    it('sends DELETE with itemIds array', async () => {
      mockFetch.mockReturnValue(mockResponse({ deletedCount: 2 }));

      const result = await client.bulkPermanentlyDeleteCanvasItems('sess-123', ['a', 'b']);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/canvas/bulk-delete-permanent', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ itemIds: ['a', 'b'] }),
      }));
      expect(result.deletedCount).toBe(2);
    });
  });
});
