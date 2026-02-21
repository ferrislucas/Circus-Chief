import { describe, it, expect, beforeEach } from 'vitest';
import { ModelProviderRepository } from './ModelProviderRepository.js';

describe('ModelProviderRepository', () => {
  let repo;

  beforeEach(() => {
    repo = new ModelProviderRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(ModelProviderRepository);
      expect(repo.tableName).toBe('model_providers');
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
      expect(provider.authToken).toBe('test-token');
      expect(provider.isBuiltIn).toBe(false);
      expect(provider.createdAt).toBeTypeOf('number');
      expect(provider.updatedAt).toBeTypeOf('number');

      // Cleanup
      repo.delete(provider.id);
    });

    it('creates a provider with default model settings', () => {
      const provider = repo.create({
        name: 'Provider with Models',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
        defaultOpusModel: 'custom-opus-v1',
        defaultSonnetModel: 'custom-sonnet-v1',
        defaultHaikuModel: 'custom-haiku-v1',
      });

      expect(provider.defaultOpusModel).toBe('custom-opus-v1');
      expect(provider.defaultSonnetModel).toBe('custom-sonnet-v1');
      expect(provider.defaultHaikuModel).toBe('custom-haiku-v1');

      // Cleanup
      repo.delete(provider.id);
    });

    it('auto-creates provider_models entries for default models', () => {
      const provider = repo.create({
        name: 'Provider with Auto Models',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
        defaultSonnetModel: 'auto-sonnet-model',
      });

      const models = repo.getModels(provider.id);
      const sonnetModel = models.find((m) => m.modelId === 'auto-sonnet-model');

      expect(sonnetModel).toBeDefined();
      expect(sonnetModel.tier).toBe('sonnet');

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
  });

  describe('getById', () => {
    it('retrieves provider by ID', () => {
      const created = repo.create({
        name: 'Retrieve Test',
        baseUrl: 'https://api.test.com',
        authToken: 'test-token',
      });

      const retrieved = repo.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Retrieve Test');

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
        name: 'AAA Custom Provider', // Name that would sort first alphabetically
        baseUrl: 'https://api.custom.com',
        authToken: 'token',
      });

      const providers = repo.getAll();

      // Built-in should be first
      expect(providers[0].isBuiltIn).toBe(true);

      // Cleanup
      repo.delete(custom.id);
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

    it('updates default model settings', () => {
      const provider = repo.create({
        name: 'Model Update Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const updated = repo.update(provider.id, {
        defaultSonnetModel: 'new-sonnet-model',
      });

      expect(updated.defaultSonnetModel).toBe('new-sonnet-model');

      // Cleanup
      repo.delete(provider.id);
    });

    it('syncs provider_models when default models are updated', () => {
      const provider = repo.create({
        name: 'Sync Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      repo.update(provider.id, {
        defaultOpusModel: 'synced-opus-model',
      });

      const models = repo.getModels(provider.id);
      const opusModel = models.find((m) => m.modelId === 'synced-opus-model');

      expect(opusModel).toBeDefined();
      expect(opusModel.tier).toBe('opus');

      // Cleanup
      repo.delete(provider.id);
    });

    it('updates existing provider_models entry when default model changes', () => {
      // Create provider with initial model
      const provider = repo.create({
        name: 'Model Update Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
        defaultSonnetModel: 'old-sonnet-v1',
      });

      // Verify initial model was created
      let models = repo.getModels(provider.id);
      expect(models.some((m) => m.modelId === 'old-sonnet-v1')).toBe(true);

      // Update to new model - this should UPDATE the existing entry, not ignore it
      repo.update(provider.id, {
        defaultSonnetModel: 'new-sonnet-v2',
      });

      // Verify the model was updated (not ignored)
      models = repo.getModels(provider.id);
      const sonnetModel = models.find((m) => m.tier === 'sonnet');

      expect(sonnetModel).toBeDefined();
      expect(sonnetModel.modelId).toBe('new-sonnet-v2');
      // Old model should no longer exist
      expect(models.some((m) => m.modelId === 'old-sonnet-v1')).toBe(false);

      // Cleanup
      repo.delete(provider.id);
    });

    it('updates multiple default models in single update', () => {
      const provider = repo.create({
        name: 'Multi Update Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
        defaultSonnetModel: 'sonnet-v1',
        defaultOpusModel: 'opus-v1',
        defaultHaikuModel: 'haiku-v1',
      });

      // Update all three models at once
      repo.update(provider.id, {
        defaultSonnetModel: 'sonnet-v2',
        defaultOpusModel: 'opus-v2',
        defaultHaikuModel: 'haiku-v2',
      });

      const models = repo.getModels(provider.id);

      expect(models.find((m) => m.tier === 'sonnet').modelId).toBe('sonnet-v2');
      expect(models.find((m) => m.tier === 'opus').modelId).toBe('opus-v2');
      expect(models.find((m) => m.tier === 'haiku').modelId).toBe('haiku-v2');

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

  describe('getModels', () => {
    it('returns models for a provider', () => {
      const provider = repo.create({
        name: 'Models Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
        defaultSonnetModel: 'test-sonnet',
        defaultOpusModel: 'test-opus',
      });

      const models = repo.getModels(provider.id);

      expect(models.length).toBeGreaterThanOrEqual(2);
      expect(models.some((m) => m.modelId === 'test-sonnet')).toBe(true);
      expect(models.some((m) => m.modelId === 'test-opus')).toBe(true);

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

  describe('addModel', () => {
    it('adds a custom model to a provider', () => {
      const provider = repo.create({
        name: 'Add Model Test',
        baseUrl: 'https://api.test.com',
        authToken: 'token',
      });

      const model = repo.addModel(provider.id, {
        modelId: 'custom-model-id',
        displayName: 'Custom Model',
        description: 'A custom model',
        tier: 'custom',
      });

      expect(model.modelId).toBe('custom-model-id');
      expect(model.displayName).toBe('Custom Model');
      expect(model.tier).toBe('custom');

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
      const result = repo.getProviderByModelId('sonnet');
      expect(result).toBeNull();
    });

    it('returns null for tier name "opus"', () => {
      const result = repo.getProviderByModelId('opus');
      expect(result).toBeNull();
    });

    it('returns null for tier name "haiku"', () => {
      const result = repo.getProviderByModelId('haiku');
      expect(result).toBeNull();
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
      // Get the built-in provider and its models
      const providers = repo.getAll();
      const builtIn = providers.find((p) => p.isBuiltIn);
      const builtInModels = repo.getModels(builtIn.id);

      if (builtInModels.length > 0) {
        const result = repo.getProviderByModelId(builtInModels[0].modelId);
        // Should return null because built-in provider uses SDK defaults
        expect(result).toBeNull();
      }
    });

    it('returns custom provider for its registered model', () => {
      const provider = repo.create({
        name: 'Lookup Test Provider',
        baseUrl: 'https://api.lookup.com',
        authToken: 'lookup-token',
        defaultSonnetModel: 'lookup-sonnet-model',
      });

      const result = repo.getProviderByModelId('lookup-sonnet-model');

      expect(result).not.toBeNull();
      expect(result.id).toBe(provider.id);
      expect(result.name).toBe('Lookup Test Provider');
      expect(result.baseUrl).toBe('https://api.lookup.com');
      expect(result.authToken).toBe('lookup-token');

      // Cleanup
      repo.delete(provider.id);
    });

    it('returns correct provider when multiple providers exist', () => {
      const provider1 = repo.create({
        name: 'Provider One',
        baseUrl: 'https://api.one.com',
        authToken: 'token-one',
        defaultSonnetModel: 'provider-one-sonnet',
      });

      const provider2 = repo.create({
        name: 'Provider Two',
        baseUrl: 'https://api.two.com',
        authToken: 'token-two',
        defaultSonnetModel: 'provider-two-sonnet',
      });

      const result1 = repo.getProviderByModelId('provider-one-sonnet');
      const result2 = repo.getProviderByModelId('provider-two-sonnet');

      expect(result1.id).toBe(provider1.id);
      expect(result2.id).toBe(provider2.id);

      // Cleanup
      repo.delete(provider1.id);
      repo.delete(provider2.id);
    });

    it('returns provider for manually added custom model', () => {
      const provider = repo.create({
        name: 'Manual Model Provider',
        baseUrl: 'https://api.manual.com',
        authToken: 'manual-token',
      });

      repo.addModel(provider.id, {
        modelId: 'manually-added-model',
        displayName: 'Manual Model',
        tier: 'custom',
      });

      const result = repo.getProviderByModelId('manually-added-model');

      expect(result).not.toBeNull();
      expect(result.id).toBe(provider.id);

      // Cleanup
      repo.delete(provider.id);
    });

    it('returns provider with all mapped fields', () => {
      const provider = repo.create({
        name: 'Full Provider',
        baseUrl: 'https://api.full.com',
        authToken: 'full-token',
        defaultOpusModel: 'full-opus',
        defaultSonnetModel: 'full-sonnet',
        defaultHaikuModel: 'full-haiku',
        apiTimeoutMs: 30000,
        additionalEnvVars: { EXTRA: 'value' },
      });

      const result = repo.getProviderByModelId('full-sonnet');

      expect(result.id).toBe(provider.id);
      expect(result.name).toBe('Full Provider');
      expect(result.baseUrl).toBe('https://api.full.com');
      expect(result.authToken).toBe('full-token');
      expect(result.defaultOpusModel).toBe('full-opus');
      expect(result.defaultSonnetModel).toBe('full-sonnet');
      expect(result.defaultHaikuModel).toBe('full-haiku');
      expect(result.apiTimeoutMs).toBe(30000);
      expect(result.additionalEnvVars).toEqual({ EXTRA: 'value' });
      expect(result.isBuiltIn).toBe(false);

      // Cleanup
      repo.delete(provider.id);
    });
  });
});
