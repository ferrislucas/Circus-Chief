import { describe, it, expect } from 'vitest';
import {
  OPENAI_MODELS,
  DEFAULT_OPENAI_MODEL,
  RETIRED_BUILT_IN_OPENAI_MODEL_IDS,
  isRetiredBuiltInOpenAIModelSelection,
} from './types.js';

describe('OPENAI_MODELS', () => {
  it('includes the GPT-5.6 family', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.6-sol');
    expect(ids).toContain('gpt-5.6-terra');
    expect(ids).toContain('gpt-5.6-luna');
  });

  it('does not include the retired gpt-5.5 model', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).not.toContain('gpt-5.5');
  });

  it('gives each GPT-5.6 model a stable seed id and display name', () => {
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-sol')).toMatchObject({
      name: 'GPT-5.6 Sol',
      seedId: 'openai-gpt-5-6-sol',
    });
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-terra')).toMatchObject({
      name: 'GPT-5.6 Terra',
      seedId: 'openai-gpt-5-6-terra',
    });
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.6-luna')).toMatchObject({
      name: 'GPT-5.6 Luna',
      seedId: 'openai-gpt-5-6-luna',
    });
  });

  it('does not expose the gpt-5.6 alias as a separate choice', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).not.toContain('gpt-5.6');
  });
});

describe('DEFAULT_OPENAI_MODEL', () => {
  it('defaults to gpt-5.6-sol', () => {
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-5.6-sol');
  });
});

describe('isRetiredBuiltInOpenAIModelSelection', () => {
  it('treats gpt-5.5 as retired for the built-in OpenAI provider', () => {
    const provider = { isBuiltIn: true, kind: 'openai' };
    expect(isRetiredBuiltInOpenAIModelSelection(provider, 'gpt-5.5')).toBe(true);
  });

  it('does not treat gpt-5.5 as retired for a custom OpenAI provider', () => {
    const provider = { isBuiltIn: false, kind: 'openai' };
    expect(isRetiredBuiltInOpenAIModelSelection(provider, 'gpt-5.5')).toBe(false);
  });

  it('does not treat current models as retired', () => {
    const provider = { isBuiltIn: true, kind: 'openai' };
    expect(isRetiredBuiltInOpenAIModelSelection(provider, 'gpt-5.6-sol')).toBe(false);
  });

  it('returns false for a missing/null provider', () => {
    expect(isRetiredBuiltInOpenAIModelSelection(null, 'gpt-5.5')).toBe(false);
    expect(isRetiredBuiltInOpenAIModelSelection(undefined, 'gpt-5.5')).toBe(false);
  });

  it('exposes the retired id list', () => {
    expect(RETIRED_BUILT_IN_OPENAI_MODEL_IDS).toEqual(['gpt-5.5']);
  });
});
