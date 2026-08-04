import { describe, expect, it } from 'vitest';
import { PromptResponse } from './prompts.js';

describe('PromptResponse', () => {
  it('keeps an optional cancellation reason through contract validation', () => {
    expect(PromptResponse.parse({ action: 'cancel', reason: 'Use the default' })).toMatchObject({
      action: 'cancel', reason: 'Use the default',
    });
  });

  it('accepts the explicit always-allow destination', () => {
    expect(PromptResponse.parse({ action: 'always_allow', destination: 'projectSettings' })).toMatchObject({
      destination: 'projectSettings',
    });
  });

  it('parses a populated answers map and annotations object without throwing', () => {
    // Regression test: z.record() requires an explicit key schema in Zod v4
    // (z.record(valueSchema) alone silently builds a broken schema that only
    // fails once a non-empty record is actually parsed).
    const result = PromptResponse.parse({
      action: 'answer',
      answers: { 'Which deployment target?': 'Staging' },
      annotations: { 'Which deployment target?': { note: 'Safer default', preview: '## Staging plan' } },
    });
    expect(result).toMatchObject({
      action: 'answer',
      answers: { 'Which deployment target?': 'Staging' },
      annotations: { 'Which deployment target?': { note: 'Safer default', preview: '## Staging plan' } },
    });
  });

  it.each([
    undefined,
    {},
    { 'Which deployment target?': '' },
  ])('rejects incomplete question answers: %j', (answers) => {
    expect(PromptResponse.safeParse({ action: 'answer', answers }).success).toBe(false);
  });

  it('continues to accept permission responses without answers', () => {
    expect(PromptResponse.safeParse({ action: 'allow' }).success).toBe(true);
  });
});
