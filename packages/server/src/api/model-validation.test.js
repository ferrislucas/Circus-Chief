import { describe, it, expect } from 'vitest';
import { modelProviders } from '../database.js';
import { validateModelId } from './model-validation.js';

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

  it('lists disabled built-in gpt-5.5 as a valid historical model id', () => {
    const result = validateModelId('not-a-real-model');
    expect(result.error).toContain('gpt-5.5');
  });

  it('accepts a retained legacy compatibility row no longer in the live catalog (upgraded DB)', () => {
    // Models retired from the OPENAI_MODELS/CLAUDE_MODELS/GEMINI_MODELS
    // constants entirely (as opposed to merely reclassified `lifecycle:
    // 'older'`) still keep their historical `provider_models` row so
    // existing sessions referencing them keep validating server-side.
    const now = Date.now();
    modelProviders.db
      .prepare(
        `INSERT INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('openai-legacy-validation-test', 'openai-default', 'gpt-legacy-validation-test', 'GPT Legacy', 'Retired', 'custom', now);

    try {
      expect(validateModelId('gpt-legacy-validation-test')).toEqual({ value: 'gpt-legacy-validation-test' });
    } finally {
      modelProviders.db.prepare('DELETE FROM provider_models WHERE id = ?').run('openai-legacy-validation-test');
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
});
