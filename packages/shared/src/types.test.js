import { describe, it, expect } from 'vitest';
import { OPENAI_MODELS, DEFAULT_OPENAI_MODEL } from './types.js';

describe('OPENAI_MODELS', () => {
  it('includes the GPT-5.6 family', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.6-sol');
    expect(ids).toContain('gpt-5.6-terra');
    expect(ids).toContain('gpt-5.6-luna');
  });

  it('includes gpt-5.5 as a disabled-by-default legacy choice', () => {
    const ids = OPENAI_MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.5');
    expect(OPENAI_MODELS.find((m) => m.id === 'gpt-5.5')).toMatchObject({ defaultEnabled: false });
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
