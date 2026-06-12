import { describe, it, expect } from 'vitest';
import { modelProviders } from '../database.js';
import { validateModelId } from './model-validation.js';

describe('validateModelId', () => {
  it('accepts a built-in model id', () => {
    expect(validateModelId('gpt-5.5')).toEqual({ value: 'gpt-5.5' });
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
    expect(result.error).toContain('gpt-5.5');
    expect(result.error).toContain('opus');
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
