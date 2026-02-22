import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRepository } from './ProviderRepository.js';

describe('ProviderRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new ProviderRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(ProviderRepository);
      expect(repo.tableName).toBe('providers');
    });
  });

  describe('create', () => {
    it('creates a provider with required fields', () => {
      const provider = repo.create({
        name: 'Test Provider',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });

      expect(provider.id).toBeDefined();
      expect(provider.name).toBe('Test Provider');
      expect(provider.baseUrl).toBe('https://api.test.com');
      expect(provider.authToken).toBe('test-token'); // Decrypted transparently
      expect(provider.isBuiltIn).toBe(false);
      expect(provider.createdAt).toBeTypeOf('number');
      expect(provider.updatedAt).toBeTypeOf('number');
      expect(provider.models).toEqual([]); // No models yet

      // Cleanup
      repo.delete(provider.id);
    });

    it('does NOT have defaultOpusModel / defaultSonnetModel / defaultHaikuModel fields', () => {
      const provider = repo.create({
        name: 'No Default Models',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });

      expect(provider.defaultOpusModel).toBeUndefined();
      expect(provider.defaultSonnetModel).toBeUndefined();
      expect(provider.defaultHaikuModel).toBeUndefined();

      // Cleanup
      repo.delete(provider.id);
    });

    it('creates a provider with additional environment variables', () => {
      const provider = repo.create({
        name: 'Provider with Env',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
        additionalEnvVars: {
          CUSTOM_VAR: 'custom-value',
          ANOTHER_VAR: 'another-value',
        },
      });

      expect(provider.additionalEnvVars).toEqual({
        CUSTOM_VAR: 'custom-value',
        ANOTHER_VAR: 'another-value',
      });

      // Cleanup
      repo.delete(provider.id);
    });

    it('encrypts auth token at rest (raw row should not contain plaintext token)', () => {
      const provider = repo.create({
        name: 'Encrypted Token Test',
        baseUrl: 'https://api.test.com',
        authToken: 'super-secret-token',
      });

      // Reading via the repo gives us the decrypted value
      expect(provider.authToken).toBe('super-secret-token');

      // Reading the raw DB row should NOT contain the plaintext token
      const rawRow = repo.db.prepare('SELECT auth_token FROM providers WHERE id = ?').get(provider.id);
      expect(rawRow.auth_token).not.toBe('super-secret-token');
      expect(rawRow.auth_token).toContain(':'); // Encrypted format: iv:authTag:ciphertext

      // Cleanup
      repo.delete(provider.id);
    });
  });

  describe('getById', () => {
    it('retrieves provider by ID with models array', () => {
      const created = repo.create({
        name: 'Retrieve Test',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });

      const retrieved = repo.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Retrieve Test');
      expect(Array.isArray(retrieved.models)).toBe(true);

      // Cleanup
      repo.delete(created.id);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getAll', () => {
    it('returns all providers including built-in', () => {
      const custom = repo.create({
        name: 'Custom Provider',
        baseUrl: 'https://api.custom.com',
        authToken: 'token',
      });

      const providers = repo.getAll();

      // Should include built-in Anthropic provider
      expect(providers.length).toBeGreaterThanOrEqual(1);
      const builtIn = providers.find((p) => p.isBuiltIn);
      expect(builtIn).toBeDefined();

      // Cleanup
      repo.delete(custom.id);
    });

    it('orders providers with built-in first', () => {
      const custom = repo.create({
        name: 'AAA Custom Provider',
        baseUrl: 'https://api.custom.com',
        authToken: 'token',
      });

      const providers = repo.getAll();

      // Built-in should be first
      expect(providers[0].isBuiltIn).toBe(true);

      // Cleanup
      repo.delete(custom.id);
    });

    it('each provider includes its models array', () => {
      const provider = repo.create({
        name: 'Models In GetAll',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      repo.addModel(provider.id, {
        modelId: 'my-sonnet-v1',
        displayName: 'My Sonnet',
        tier: 'sonnet',
      });

      const providers = repo.getAll();
      const found = providers.find((p) => p.id === provider.id);

      expect(found).toBeDefined();
      expect(Array.isArray(found.models)).toBe(true);
      expect(found.models.some((m) => m.modelId === 'my-sonnet-v1')).toBe(true);

      // Cleanup
      repo.delete(provider.id);
    });
  });

  describe('update', () => {
    it('updates provider name', () => {
      const provider = repo.create({
        name: 'Original Name',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const updated = repo.update(provider.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');

      // Cleanup
      repo.delete(provider.id);
    });

    it('updating auth token re-encrypts it', () => {
      const provider = repo.create({
        name: 'Token Update Test',
        baseUrl: 'https://api.test.com',
        authToken: 'original-token',
      });

      repo.update(provider.id, { authToken: 'new-token' });

      const retrieved = repo.getById(provider.id);
      expect(retrieved.authToken).toBe('new-token');

      // Raw should still be encrypted
      const rawRow = repo.db.prepare('SELECT auth_token FROM providers WHERE id = ?').get(provider.id);
      expect(rawRow.auth_token).not.toBe('new-token');

      // Cleanup
      repo.delete(provider.id);
    });

    it('does NOT sync provider_models (no auto-sync)', () => {
      const provider = repo.create({
        name: 'No Sync Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      // Update with fields that previously would have triggered a sync
      repo.update(provider.id, { name: 'Updated' });

      // Models should remain empty (no auto-sync)
      const models = repo.getModels(provider.id);
      expect(models).toEqual([]);

      // Cleanup
      repo.delete(provider.id);
    });
  });

  describe('delete', () => {
    it('deletes a custom provider', () => {
      const provider = repo.create({
        name: 'Delete Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      repo.delete(provider.id);

      expect(repo.getById(provider.id)).toBeNull();
    });

    it('throws error when deleting built-in provider', () => {
      const providers = repo.getAll();
      const builtIn = providers.find((p) => p.isBuiltIn);

      expect(() => repo.delete(builtIn.id)).toThrow('Cannot delete built-in provider');
    });

    it('throws error when provider not found', () => {
      expect(() => repo.delete('non-existent')).toThrow('Provider not found');
    });
  });

  describe('addModel / getModels', () => {
    it('adds a model to a provider and retrieves it', () => {
      const provider = repo.create({
        name: 'Add Model Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const model = repo.addModel(provider.id, {
        modelId: 'custom-model-id',
        displayName: 'Custom Model',
        description: 'A custom model',
        tier: 'sonnet',
      });

      expect(model.modelId).toBe('custom-model-id');
      expect(model.displayName).toBe('Custom Model');
      expect(model.tier).toBe('sonnet');

      const models = repo.getModels(provider.id);
      expect(models.length).toBe(1);
      expect(models[0].modelId).toBe('custom-model-id');

      // Cleanup
      repo.delete(provider.id);
    });

    it('adds multiple models and all appear in getModels', () => {
      const provider = repo.create({
        name: 'Multi Model Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      repo.addModel(provider.id, { modelId: 'model-opus', displayName: 'Opus', tier: 'opus' });
      repo.addModel(provider.id, { modelId: 'model-sonnet', displayName: 'Sonnet', tier: 'sonnet' });
      repo.addModel(provider.id, { modelId: 'model-haiku', displayName: 'Haiku', tier: 'haiku' });

      const models = repo.getModels(provider.id);
      expect(models.length).toBe(3);
      expect(models.some((m) => m.tier === 'opus')).toBe(true);
      expect(models.some((m) => m.tier === 'sonnet')).toBe(true);
      expect(models.some((m) => m.tier === 'haiku')).toBe(true);

      // Cleanup
      repo.delete(provider.id);
    });

    it('returns empty array for provider with no models', () => {
      const provider = repo.create({
        name: 'No Models',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const models = repo.getModels(provider.id);

      expect(models).toEqual([]);

      // Cleanup
      repo.delete(provider.id);
    });
  });

  describe('removeModel', () => {
    it('removes a model from a provider', () => {
      const provider = repo.create({
        name: 'Remove Model Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const model = repo.addModel(provider.id, {
        modelId: 'to-remove',
        displayName: 'To Remove',
      });

      repo.removeModel(model.id);

      const models = repo.getModels(provider.id);
      expect(models.find((m) => m.id === model.id)).toBeUndefined();

      // Cleanup
      repo.delete(provider.id);
    });
  });

  describe('getProviderByModelId', () => {
    it('returns null for null model ID', () => {
      const result = repo.getProviderByModelId(null);
      expect(result).toBeNull();
    });

    it('returns null for undefined model ID', () => {
      const result = repo.getProviderByModelId(undefined);
      expect(result).toBeNull();
    });

    it('returns null for tier name "sonnet"', () => {
      expect(repo.getProviderByModelId('sonnet')).toBeNull();
    });

    it('returns null for tier name "opus"', () => {
      expect(repo.getProviderByModelId('opus')).toBeNull();
    });

    it('returns null for tier name "haiku"', () => {
      expect(repo.getProviderByModelId('haiku')).toBeNull();
    });

    it('returns null for tier names in uppercase', () => {
      expect(repo.getProviderByModelId('SONNET')).toBeNull();
      expect(repo.getProviderByModelId('OPUS')).toBeNull();
      expect(repo.getProviderByModelId('HAIKU')).toBeNull();
    });

    it('returns null for model not found in any provider', () => {
      const result = repo.getProviderByModelId('unknown-model-xyz');
      expect(result).toBeNull();
    });

    it('returns null for models from built-in Anthropic provider', () => {
      const providers = repo.getAll();
      const builtIn = providers.find((p) => p.isBuiltIn);
      const builtInModels = repo.getModels(builtIn.id);

      if (builtInModels.length > 0) {
        const result = repo.getProviderByModelId(builtInModels[0].modelId);
        expect(result).toBeNull();
      }
    });

    it('returns custom provider for its registered model (added via addModel)', () => {
      const provider = repo.create({
        name: 'Lookup Test Provider',
        baseUrl: 'https://api.lookup.com',
        authToken: 'lookup-token',
      });

      repo.addModel(provider.id, {
        modelId: 'lookup-sonnet-model',
        displayName: 'Lookup Sonnet',
        tier: 'sonnet',
      });

      const result = repo.getProviderByModelId('lookup-sonnet-model');

      expect(result).not.toBeNull();
      expect(result.id).toBe(provider.id);
      expect(result.name).toBe('Lookup Test Provider');
      expect(result.baseUrl).toBe('https://api.lookup.com');
      expect(result.authToken).toBe('lookup-token'); // Decrypted

      // Cleanup
      repo.delete(provider.id);
    });

    it('returns correct provider when multiple providers exist', () => {
      const provider1 = repo.create({
        name: 'Provider One',
        baseUrl: 'https://api.one.com',
        authToken: 'token-one',
      });
      repo.addModel(provider1.id, { modelId: 'provider-one-sonnet', displayName: 'P1 Sonnet', tier: 'sonnet' });

      const provider2 = repo.create({
        name: 'Provider Two',
        baseUrl: 'https://api.two.com',
        authToken: 'token-two',
      });
      repo.addModel(provider2.id, { modelId: 'provider-two-sonnet', displayName: 'P2 Sonnet', tier: 'sonnet' });

      const result1 = repo.getProviderByModelId('provider-one-sonnet');
      const result2 = repo.getProviderByModelId('provider-two-sonnet');

      expect(result1.id).toBe(provider1.id);
      expect(result2.id).toBe(provider2.id);

      // Cleanup
      repo.delete(provider1.id);
      repo.delete(provider2.id);
    });

    it('returns provider with models array included', () => {
      const provider = repo.create({
        name: 'Full Provider',
        baseUrl: 'https://api.full.com',
        authToken: 'full-token',
        apiTimeoutMs: 30000,
        additionalEnvVars: { EXTRA: 'value' },
      });

      repo.addModel(provider.id, { modelId: 'full-opus', displayName: 'Opus', tier: 'opus' });
      repo.addModel(provider.id, { modelId: 'full-sonnet', displayName: 'Sonnet', tier: 'sonnet' });
      repo.addModel(provider.id, { modelId: 'full-haiku', displayName: 'Haiku', tier: 'haiku' });

      const result = repo.getProviderByModelId('full-sonnet');

      expect(result.id).toBe(provider.id);
      expect(result.name).toBe('Full Provider');
      expect(result.baseUrl).toBe('https://api.full.com');
      expect(result.authToken).toBe('full-token');
      expect(result.apiTimeoutMs).toBe(30000);
      expect(result.additionalEnvVars).toEqual({ EXTRA: 'value' });
      expect(result.isBuiltIn).toBe(false);

      // Models array should contain all three models
      expect(Array.isArray(result.models)).toBe(true);
      expect(result.models.length).toBe(3);
      expect(result.models.some((m) => m.tier === 'opus' && m.modelId === 'full-opus')).toBe(true);
      expect(result.models.some((m) => m.tier === 'sonnet' && m.modelId === 'full-sonnet')).toBe(true);
      expect(result.models.some((m) => m.tier === 'haiku' && m.modelId === 'full-haiku')).toBe(true);

      // No legacy default model fields
      expect(result.defaultOpusModel).toBeUndefined();
      expect(result.defaultSonnetModel).toBeUndefined();
      expect(result.defaultHaikuModel).toBeUndefined();

      // Cleanup
      repo.delete(provider.id);
    });
  });
});
