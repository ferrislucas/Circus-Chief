import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('ConversationsApi', () => {
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

  describe('getConversations', () => {
    it('sends GET to /sessions/:id/conversations', async () => {
      const conversations = [{ id: 'conv-1', name: 'Main', isActive: true }];
      mockFetch.mockReturnValue(mockResponse(conversations));

      const result = await client.getConversations('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.any(Object));
      expect(result).toEqual(conversations);
    });
  });

  describe('createConversation', () => {
    it('sends POST with name', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-new', name: 'My Conv' }));

      await client.createConversation('sess-123', 'My Conv');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'My Conv' }),
      }));
    });

    it('sends POST with null name when omitted', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-new', name: null }));

      await client.createConversation('sess-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations', expect.objectContaining({
        body: JSON.stringify({ name: null }),
      }));
    });
  });

  describe('getConversation', () => {
    it('sends GET to /sessions/:id/conversations/:convId', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-1', name: 'Test' }));

      const result = await client.getConversation('sess-123', 'conv-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.any(Object));
      expect(result.name).toBe('Test');
    });
  });

  describe('updateConversation', () => {
    it('sends PATCH with update data', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-1', name: 'Renamed' }));

      await client.updateConversation('sess-123', 'conv-1', { name: 'Renamed' });

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
      }));
    });

    it('can update isActive', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-1', isActive: true }));

      await client.updateConversation('sess-123', 'conv-1', { isActive: true });

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
        body: JSON.stringify({ isActive: true }),
      }));
    });
  });

  describe('deleteConversation', () => {
    it('sends DELETE to /sessions/:id/conversations/:convId', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteConversation('sess-123', 'conv-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('generateConversationSummary', () => {
    it('sends POST to /sessions/:id/conversations/:convId/summary', async () => {
      mockFetch.mockReturnValue(mockResponse({ summary: 'A summary' }));

      const result = await client.generateConversationSummary('sess-123', 'conv-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1/summary', expect.objectContaining({
        method: 'POST',
      }));
      expect(result.summary).toBe('A summary');
    });
  });

  describe('branchConversation', () => {
    it('sends POST to branch endpoint', async () => {
      const branchData = { messageId: 'msg-5', name: 'Branch', prompt: 'Follow up' };
      mockFetch.mockReturnValue(mockResponse({ id: 'conv-branch' }));

      const result = await client.branchConversation('sess-123', 'conv-1', branchData);

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/conversations/conv-1/branch', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(branchData),
      }));
      expect(result.id).toBe('conv-branch');
    });
  });

  describe('getConversationMessages', () => {
    it('sends GET with conversation_id query parameter', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: 'msg-1', role: 'user' }]));

      const result = await client.getConversationMessages('sess-123', 'conv-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/sess-123/messages?conversation_id=conv-1', expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });
});
