import { describe, it, expect } from 'vitest';
import {
  resolveGlmContextWindow,
  resolveContextWindow,
  GLM_DEFAULT_CONTEXT_WINDOW,
  GLM_LARGE_CONTEXT_WINDOW,
} from './modelContextWindows.js';

describe('resolveGlmContextWindow', () => {
  it('resolves the 1M window only for opted-in [1m] GLM-5.2/5.3 models', () => {
    expect(resolveGlmContextWindow('GLM-5.2[1m]')).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-5.3[1m]')).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-5.3-flash[1m]')).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('GLM-5.3-Flash[1M]')).toBe(GLM_LARGE_CONTEXT_WINDOW);
  });

  it('keeps the 200K default for bare GLM-5.2/5.3 models without long-context opt-in', () => {
    expect(resolveGlmContextWindow('GLM-5.2')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-5.3')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('GLM-5.3-Flash')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('resolves the 200K window for older GLM models', () => {
    expect(resolveGlmContextWindow('GLM-5-turbo')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-4.7')).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('does not grant the 1M window to lookalike model ids', () => {
    // A longer version segment is a different model, not a 5.2/5.3 variant.
    expect(resolveGlmContextWindow('glm-5.20')).not.toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveGlmContextWindow('glm-5.30-flash')).not.toBe(GLM_LARGE_CONTEXT_WINDOW);
    // Not a GLM model id at all: unrecognized, so callers keep their fallback.
    expect(resolveGlmContextWindow('glmfoo')).toBeUndefined();
    expect(resolveGlmContextWindow('aglm-5.3[1m]')).toBeUndefined();
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
    expect(resolveContextWindow({ model: 'glm-5.3-flash[1m]', reported: 500000 })).toBe(500000);
  });

  it('falls back to GLM knowledge when nothing is reported', () => {
    expect(resolveContextWindow({ model: 'glm-5.3-flash[1m]' })).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'GLM-5.3-Flash' })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'GLM-4.7', reported: null })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['NaN', NaN],
    ['string', '1048576'],
    ['null', null],
    ['undefined', undefined],
  ])('ignores an invalid reported window (%s) and uses model knowledge', (_label, reported) => {
    expect(resolveContextWindow({ model: 'glm-5.3-flash[1m]', reported })).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'GLM-5.2', reported })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('uses the session-configured model opt-in when the runtime model lost the [1m] suffix', () => {
    expect(resolveContextWindow({ model: 'glm-5.3', configuredModel: 'GLM-5.3[1m]' })).toBe(GLM_LARGE_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: null, configuredModel: 'glm-5.2[1m]' })).toBe(GLM_LARGE_CONTEXT_WINDOW);
  });

  it('keeps the 200K default when neither runtime nor configured model opts in', () => {
    expect(resolveContextWindow({ model: 'glm-5.3', configuredModel: 'GLM-5.3' })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'glm-5.3' })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
  });

  it('keeps the 200000 default for unknown models', () => {
    expect(resolveContextWindow({ model: 'claude-sonnet-5' })).toBe(200000);
    expect(resolveContextWindow({})).toBe(200000);
  });

  it('does not confuse the auto-compact threshold with model capacity', () => {
    // CLAUDE_CODE_AUTO_COMPACT_WINDOW is a compaction trigger in tokens, not
    // the model's context capacity: it must never inflate the fallback.
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '1000000';
    try {
      expect(resolveContextWindow({ model: 'GLM-5.2' })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
      expect(resolveContextWindow({ model: 'glm-5.3-flash' })).toBe(GLM_DEFAULT_CONTEXT_WINDOW);
    } finally {
      delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    }
  });
});
