import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ── Mock api (hoisted so it's defined before vi.mock runs) ────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getProviders: vi.fn(),
    getProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    testProviderConnection: vi.fn(),
    testExistingProvider: vi.fn(),
    getProviderModels: vi.fn(),
    addProviderModel: vi.fn(),
    updateProviderModel: vi.fn(),
    removeProviderModel: vi.fn(),
  },
}));

vi.mock('../composables/useApi.js', () => ({
  api: mockApi,
}));

// Import after mocking
import { useProvidersStore } from './providers.js';

describe('useProvidersStore — Phase 5 kind wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('fetchProviders', () => {
    it('ignores a stale response that resolves after a newer fetch', async () => {
      let resolveStale;
      let resolveFresh;
      mockApi.getProviders
        .mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }))
        .mockImplementationOnce(() => new Promise((r) => { resolveFresh = r; }));

      const store = useProvidersStore();
      const stale = store.fetchProviders();
      const fresh = store.fetchProviders();
      resolveFresh([{ id: 'new', name: 'New' }]);
      await fresh;
      resolveStale([{ id: 'old', name: 'Old' }]);
      await stale;

      expect(store.providers).toEqual([{ id: 'new', name: 'New' }]);
    });

    it('reports success so refresh consumers can tell cached data from a fresh fetch', async () => {
      mockApi.getProviders.mockReset();
      mockApi.getProviders.mockResolvedValue([{ id: 'p1', name: 'P1' }]);

      const store = useProvidersStore();
      await store.fetchProviders();

      expect(store.lastFetchSucceeded).toBe(true);
      mockApi.getProviders.mockReset();
    });

    it('reports failure while still returning cached data to existing callers', async () => {
      mockApi.getProviders.mockReset();
      mockApi.getProviders
        .mockResolvedValueOnce([{ id: 'p1', name: 'P1' }])
        .mockRejectedValueOnce(new Error('offline'));

      const store = useProvidersStore();
      // Perform every stubbed call before asserting: an early red assertion
      // must not leak an unconsumed Once implementation into later tests.
      await store.fetchProviders();
      const afterSuccess = store.lastFetchSucceeded;
      const cached = await store.fetchProviders();
      const afterFailure = store.lastFetchSucceeded;

      expect(afterSuccess).toBe(true);
      expect(cached).toEqual([{ id: 'p1', name: 'P1' }]);
      expect(afterFailure).toBe(false);
      expect(store.providers).toEqual([{ id: 'p1', name: 'P1' }]);
      mockApi.getProviders.mockReset();
    });
  });

  describe('createProvider', () => {
    it('forwards kind to the api layer', async () => {
      const payload = {
        name: 'Codex',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-test',
      };
      mockApi.createProvider.mockResolvedValue({ id: 'p1', ...payload });

      const store = useProvidersStore();
      const created = await store.createProvider(payload);

      expect(mockApi.createProvider).toHaveBeenCalledWith(payload);
      expect(created.kind).toBe('openai');
      expect(store.providers).toContainEqual(expect.objectContaining({ id: 'p1', kind: 'openai' }));
    });

    it('forwards kind=anthropic on create', async () => {
      const payload = { name: 'Custom', kind: 'anthropic', baseUrl: 'https://x.example.com' };
      mockApi.createProvider.mockResolvedValue({ id: 'p2', ...payload });

      const store = useProvidersStore();
      await store.createProvider(payload);

      expect(mockApi.createProvider).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'anthropic' }),
      );
    });
  });

  describe('updateProvider', () => {
    it('strips kind from the payload before calling the api', async () => {
      mockApi.updateProvider.mockResolvedValue({ id: 'p1', name: 'Updated' });

      const store = useProvidersStore();
      await store.updateProvider('p1', { name: 'Updated', kind: 'openai' });

      expect(mockApi.updateProvider).toHaveBeenCalledWith('p1', { name: 'Updated' });
      const arg = mockApi.updateProvider.mock.calls[0][1];
      expect(arg).not.toHaveProperty('kind');
    });

    it('passes other fields through unchanged', async () => {
      mockApi.updateProvider.mockResolvedValue({ id: 'p1' });

      const store = useProvidersStore();
      await store.updateProvider('p1', {
        name: 'N',
        baseUrl: 'https://a',
        authToken: 'tok',
        apiTimeoutMs: 12345,
        additionalEnvVars: { A: 'B' },
        commitAttributionOverride: 'Codex <noreply@openai.com>',
      });

      expect(mockApi.updateProvider).toHaveBeenCalledWith('p1', {
        name: 'N',
        baseUrl: 'https://a',
        authToken: 'tok',
        apiTimeoutMs: 12345,
        additionalEnvVars: { A: 'B' },
        commitAttributionOverride: 'Codex <noreply@openai.com>',
      });
    });

    it('handles an undefined updates payload gracefully', async () => {
      mockApi.updateProvider.mockResolvedValue({ id: 'p1' });

      const store = useProvidersStore();
      await store.updateProvider('p1', undefined);

      expect(mockApi.updateProvider).toHaveBeenCalledWith('p1', {});
    });
  });

  describe('testConnection', () => {
    it('forwards kind=openai in the narrow payload', async () => {
      mockApi.testProviderConnection.mockResolvedValue({ success: true });

      const store = useProvidersStore();
      const config = {
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-test',
        defaultSonnetModel: 'gpt-4o',
        apiTimeoutMs: 60000,
      };
      await store.testConnection(config);

      expect(mockApi.testProviderConnection).toHaveBeenCalledWith(config);
    });

    it('forwards kind=anthropic in the narrow payload', async () => {
      mockApi.testProviderConnection.mockResolvedValue({ success: true });

      const store = useProvidersStore();
      const config = {
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        authToken: 'ant-test',
        defaultSonnetModel: 'claude-3-sonnet',
        apiTimeoutMs: 60000,
      };
      await store.testConnection(config);

      expect(mockApi.testProviderConnection).toHaveBeenCalledWith(config);
    });
  });
});
