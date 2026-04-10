import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../ApiClient.js';

describe('ProvidersApi', () => {
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

  describe('getProviders', () => {
    it('sends GET to /providers', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: '1', name: 'Anthropic' }]));

      const result = await client.getProviders();

      expect(mockFetch).toHaveBeenCalledWith('/api/providers', expect.objectContaining({ method: 'GET' }));
      expect(result).toHaveLength(1);
    });
  });

  describe('getProvider', () => {
    it('sends GET to /providers/:id', async () => {
      mockFetch.mockReturnValue(mockResponse({ id: 'prov-1', name: 'Anthropic' }));

      const result = await client.getProvider('prov-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1', expect.any(Object));
      expect(result.name).toBe('Anthropic');
    });
  });

  describe('createProvider', () => {
    it('sends POST to /providers with data', async () => {
      const data = { name: 'Custom', apiKey: 'sk-...' };
      mockFetch.mockReturnValue(mockResponse({ id: 'prov-1', ...data }));

      await client.createProvider(data);

      expect(mockFetch).toHaveBeenCalledWith('/api/providers', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('updateProvider', () => {
    it('sends PATCH to /providers/:id with data', async () => {
      const data = { name: 'Updated' };
      mockFetch.mockReturnValue(mockResponse({ id: 'prov-1', ...data }));

      await client.updateProvider('prov-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('deleteProvider', () => {
    it('sends DELETE to /providers/:id', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.deleteProvider('prov-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('testProviderConnection', () => {
    it('sends POST to /providers/test with config', async () => {
      const config = { apiKey: 'sk-test', baseUrl: 'https://api.example.com' };
      mockFetch.mockReturnValue(mockResponse({ success: true, message: 'Connected' }));

      const result = await client.testProviderConnection(config);

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/test', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(config),
      }));
      expect(result.success).toBe(true);
    });
  });

  describe('testExistingProvider', () => {
    it('sends POST to /providers/:id/test', async () => {
      mockFetch.mockReturnValue(mockResponse({ success: true, message: 'OK' }));

      const result = await client.testExistingProvider('prov-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1/test', expect.objectContaining({ method: 'POST' }));
      expect(result.success).toBe(true);
    });
  });

  describe('getProviderModels', () => {
    it('sends GET to /providers/:id/models', async () => {
      mockFetch.mockReturnValue(mockResponse([{ id: 'model-1', name: 'claude-sonnet-4-20250514' }]));

      const result = await client.getProviderModels('prov-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1/models', expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });

  describe('addProviderModel', () => {
    it('sends POST to /providers/:id/models', async () => {
      const data = { name: 'claude-sonnet-4-20250514', modelId: 'claude-sonnet-4-20250514' };
      mockFetch.mockReturnValue(mockResponse({ id: 'model-1', ...data }));

      await client.addProviderModel('prov-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1/models', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('updateProviderModel', () => {
    it('sends PATCH to /providers/:providerId/models/:modelId', async () => {
      const data = { name: 'Updated Model' };
      mockFetch.mockReturnValue(mockResponse({ id: 'model-1', ...data }));

      await client.updateProviderModel('prov-1', 'model-1', data);

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1/models/model-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(data),
      }));
    });
  });

  describe('removeProviderModel', () => {
    it('sends DELETE to /providers/:providerId/models/:modelId', async () => {
      mockFetch.mockReturnValue(mockResponse(null, { status: 204 }));

      await client.removeProviderModel('prov-1', 'model-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/providers/prov-1/models/model-1', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });
});
