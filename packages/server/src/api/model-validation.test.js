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
});
