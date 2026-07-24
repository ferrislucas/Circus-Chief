import { describe, it, expect } from 'vitest';
import { modelProviders, modelTiers } from '../database.js';
import { validateModelId, validateModelAndProvider } from './model-validation.js';
import { buildTierRef } from '@circuschief/shared';

describe('validateModelId', () => {
  it('accepts a built-in model id', () => {
    expect(validateModelId('gpt-5.6-sol')).toEqual({ value: 'gpt-5.6-sol' });
  });

  it('accepts tier aliases case-insensitively', () => {
    expect(validateModelId('opus')).toEqual({ value: 'opus' });
    expect(validateModelId('OpUs')).toEqual({ value: 'OpUs' });
  });

  it('accepts null, undefined, and empty string by default', () => {
    expect(validateModelId(null)).toEqual({ value: null });
    expect(validateModelId(undefined)).toEqual({ value: undefined });
    expect(validateModelId('')).toEqual({ value: '' });
  });

  it('rejects non-string values', () => {
    expect(validateModelId(123)).toEqual({ error: 'model must be a string or null' });
  });

  it('rejects unknown model ids and lists valid ids', () => {
    const result = validateModelId('not-a-real-model');

    expect(result.error).toContain('Invalid model id "not-a-real-model"');
    expect(result.error).toContain('Valid model ids are:');
    expect(result.error).toContain('gpt-5.6-sol');
    expect(result.error).toContain('opus');
  });

  it('does not list the retired gpt-5.5 id on a fresh database', () => {
    const result = validateModelId('not-a-real-model');
    expect(result.error).not.toContain('gpt-5.5');
  });

  it('accepts a retained legacy gpt-5.5 compatibility row (upgraded DB)', () => {
    // Fresh DBs no longer seed gpt-5.5, but upgraded installations retain the
    // historical built-in row so existing gpt-5.5 sessions keep validating.
    const now = Date.now();
    modelProviders.db
      .prepare(
        `INSERT INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('openai-gpt-5-5-validation-test', 'openai-default', 'gpt-5.5', 'GPT-5.5', 'Retired', 'custom', now);

    try {
      expect(validateModelId('gpt-5.5')).toEqual({ value: 'gpt-5.5' });
    } finally {
      modelProviders.db.prepare('DELETE FROM provider_models WHERE id = ?').run('openai-gpt-5-5-validation-test');
    }
  });

  it('accepts user-registered custom model ids', () => {
    const provider = modelProviders.create({
      name: 'Custom OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      authToken: 'token',
    });
    modelProviders.addModel(provider.id, {
      modelId: 'custom-model-validation-test',
      displayName: 'Custom Model',
      tier: 'custom',
    });

    try {
      expect(validateModelId('custom-model-validation-test')).toEqual({
        value: 'custom-model-validation-test',
      });
    } finally {
      modelProviders.delete(provider.id);
    }
  });

  describe('Model Tier references', () => {
    function makeProviderWithModel(kind, modelId) {
      const provider = modelProviders.create({
        name: `Tier-ref test provider (${kind}/${modelId})`,
        kind,
        baseUrl: 'https://api.example.com/v1',
        authToken: 'token',
      });
      modelProviders.addModel(provider.id, { modelId, displayName: modelId, tier: 'custom' });
      return provider;
    }

    it('accepts a tier ref that resolves to an enabled member', () => {
      const provider = makeProviderWithModel('openai', 'tier-ref-valid-model');
      const tier = modelTiers.create({
        name: 'Tier Ref Valid Test',
        members: [{ providerId: provider.id, modelId: 'tier-ref-valid-model', position: 0 }],
      });

      try {
        expect(validateModelId(buildTierRef(tier.id))).toEqual({ value: buildTierRef(tier.id) });
      } finally {
        modelTiers.delete(tier.id);
        modelProviders.delete(provider.id);
      }
    });

    it('rejects a malformed tier ref (empty id)', () => {
      const result = validateModelId('tier::');
      expect(result.error).toContain('malformed tier reference');
    });

    it('rejects a tier ref for an unknown tier id', () => {
      const result = validateModelId(buildTierRef('00000000-0000-0000-0000-000000000000'));
      expect(result.error).toContain('does not exist or has no enabled members');
    });

    it('rejects a tier ref whose tier has no enabled members', () => {
      const tier = modelTiers.create({ name: 'Tier Ref Empty Test', members: [] });
      try {
        const result = validateModelId(buildTierRef(tier.id));
        expect(result.error).toContain('does not exist or has no enabled members');
      } finally {
        modelTiers.delete(tier.id);
      }
    });

    it('rejects a tier ref whose only member was deleted from its provider', () => {
      const provider = modelProviders.create({
        name: 'Tier-ref orphan test provider',
        kind: 'openai',
        baseUrl: 'https://api.example.com/v1',
        authToken: 'token',
      });
      const model = modelProviders.addModel(provider.id, {
        modelId: 'tier-ref-orphan-model',
        displayName: 'tier-ref-orphan-model',
        tier: 'custom',
      });
      const tier = modelTiers.create({
        name: 'Tier Ref Orphan Test',
        members: [{ providerId: provider.id, modelId: 'tier-ref-orphan-model', position: 0 }],
      });

      try {
        modelProviders.removeModel(model.id);
        const result = validateModelId(buildTierRef(tier.id));
        expect(result.error).toContain('does not exist or has no enabled members');
      } finally {
        modelTiers.delete(tier.id);
        modelProviders.delete(provider.id);
      }
    });
  });
});

describe('validateModelAndProvider', () => {
  it('passes through a concrete model with its providerId', () => {
    expect(validateModelAndProvider('gpt-5.6-sol', 'some-provider-id')).toEqual({
      model: 'gpt-5.6-sol',
      providerId: 'some-provider-id',
    });
  });

  it('normalizes providerId to null for a valid tier ref', () => {
    const provider = modelProviders.create({
      name: 'Tier + provider normalization test',
      kind: 'openai',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'token',
    });
    modelProviders.addModel(provider.id, {
      modelId: 'tier-provider-norm-model',
      displayName: 'Norm Model',
      tier: 'custom',
    });
    const tier = modelTiers.create({
      name: 'Tier + provider normalization test',
      members: [{ providerId: provider.id, modelId: 'tier-provider-norm-model', position: 0 }],
    });

    try {
      const ref = buildTierRef(tier.id);
      expect(validateModelAndProvider(ref, null)).toEqual({ model: ref, providerId: null });
      expect(validateModelAndProvider(ref, undefined)).toEqual({ model: ref, providerId: null });
    } finally {
      modelTiers.delete(tier.id);
      modelProviders.delete(provider.id);
    }
  });

  it('rejects a concrete providerId supplied alongside a tier ref', () => {
    const provider = modelProviders.create({
      name: 'Tier + stray provider test',
      kind: 'openai',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'token',
    });
    modelProviders.addModel(provider.id, {
      modelId: 'tier-stray-provider-model',
      displayName: 'Stray Model',
      tier: 'custom',
    });
    const tier = modelTiers.create({
      name: 'Tier + stray provider test',
      members: [{ providerId: provider.id, modelId: 'tier-stray-provider-model', position: 0 }],
    });

    try {
      const ref = buildTierRef(tier.id);
      const result = validateModelAndProvider(ref, provider.id);
      expect(result.error).toContain('providerId must be null when model is a tier reference');
    } finally {
      modelTiers.delete(tier.id);
      modelProviders.delete(provider.id);
    }
  });

  it('propagates the underlying model validation error', () => {
    expect(validateModelAndProvider('not-a-real-model', null).error).toContain('Invalid model id');
  });
});
