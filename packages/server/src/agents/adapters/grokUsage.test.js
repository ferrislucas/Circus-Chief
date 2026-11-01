import { beforeEach, describe, expect, it } from 'vitest';
import { _resetGrokUsageTotalsForTests, usageFromGrokPrompt } from './grokUsage.js';

describe('grok prompt usage', () => {
  beforeEach(() => _resetGrokUsageTotalsForTests());

  it('keeps a per-turn breakdown, including cache and reasoning', () => {
    expect(usageFromGrokPrompt({
      _meta: { inputTokens: 3, outputTokens: 2, cachedReadTokens: 4, reasoningTokens: 1, totalTokens: 9 },
    }, 'sess')).toEqual({
      input_tokens: 3,
      output_tokens: 2,
      cache_read_input_tokens: 4,
      thinking_tokens: 1,
    });
  });

  it('does not add a running totalTokens snapshot', () => {
    expect(usageFromGrokPrompt({ _meta: { totalTokens: 100 } }, 'sess')).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(usageFromGrokPrompt({ _meta: { totalTokens: 140 } }, 'sess')).toEqual({ input_tokens: 40, output_tokens: 0 });
    expect(usageFromGrokPrompt({ _meta: { totalTokens: 140 } }, 'other')).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
