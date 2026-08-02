import { describe, expect, it } from 'vitest';
import { PromptResponse } from './prompts.js';

describe('PromptResponse', () => {
  it('keeps an optional skip reason through contract validation', () => {
    expect(PromptResponse.parse({ action: 'skip', reason: 'Use the default' })).toMatchObject({
      action: 'skip', reason: 'Use the default',
    });
  });

  it('accepts the explicit always-allow destination', () => {
    expect(PromptResponse.parse({ action: 'always', destination: 'projectSettings' })).toMatchObject({
      destination: 'projectSettings',
    });
  });
});
