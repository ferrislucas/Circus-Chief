import { describe, it, expect } from 'vitest';
import {
  resolveGlmContextWindow,
  resolveContextWindow,
  GLM_DEFAULT_CONTEXT_WINDOW,
  GLM_LARGE_CONTEXT_WINDOW,
} from './modelContextWindows.js';

describe('resolveGlmContextWindow', () => {
  it('resolves the 1M window for GLM-5.3 models in any casing', () => {
    expect(resolveGlmContextWindow('GLM-5.3-Flash')).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-5.3')).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('GLM-5.2')).toBe(GLM_LARGE_CONTEXT_WINDOW);
  });

  it('resolves the 200K window for older GLM models', () => {
    expect(resolveGlmContextWindow('GLM-5-turbo')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-4.7')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('returns undefined for non-GLM and non-string input', () => {
    expect(resolveGlmContextWindow('claude-sonnet-5')).toBeUndefined();
    expect(resolveGlmContextWindow(null)).toBeUndefined();
    expect(resolveGlmContextWindow('')).toBeUndefined();
    expect(resolveGlmContextWindow(42)).toBeUndefined();
  });
});

describe('resolveContextWindow', () => {
  it('prefers a reported window over model knowledge', () => {
    expect(resolveContextWindow({ model: 'GLM-5.3-Flash', reported: 500000 })).toBe(500000);
  });

  it('falls back to GLM knowledge when nothing is reported', () => {
    expect(resolveContextWindow({ model: 'GLM-5.3-Flash' })).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'GLM-4.7', reported: null })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('keeps the 200000 default for unknown models', () => {
    expect(resolveContextWindow({ model: 'claude-sonnet-5' })).toBe(200000);
    expect(resolveContextWindow({})).toBe(200000);
  });
});
