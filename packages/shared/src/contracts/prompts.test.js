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
      answers: { 'Which deployment target?': ['Staging'] },
      annotations: { 'Which deployment target?': { notes: 'Safer default', preview: '## Staging plan' } },
    });
    expect(result).toMatchObject({
      action: 'answer',
      answers: { 'Which deployment target?': ['Staging'] },
      annotations: { 'Which deployment target?': { notes: 'Safer default', preview: '## Staging plan' } },
    });
  });

  it('accepts an explicit custom answer with an empty predefined selection', () => {
    expect(PromptResponse.safeParse({
      action: 'answer', answers: { Checks: [] }, customAnswers: { Checks: 'Accessibility, performance' },
    }).success).toBe(true);
  });

  it('preserves meaningful custom-answer whitespace while rejecting blank input', () => {
    const result = PromptResponse.safeParse({
      action: 'answer', answers: { Checks: [] }, customAnswers: { Checks: '  Accessibility, performance  ' },
    });
    expect(result).toMatchObject({ success: true, data: { customAnswers: { Checks: '  Accessibility, performance  ' } } });
    expect(PromptResponse.safeParse({
      action: 'answer', answers: { Checks: [] }, customAnswers: { Checks: '   ' },
    }).success).toBe(false);
  });

  it('rejects obsolete singular note annotations and string selections', () => {
    expect(PromptResponse.safeParse({
      action: 'answer', answers: { Choice: 'A' }, annotations: { Choice: { note: 'legacy' } },
    }).success).toBe(false);
  });

  it.each([
    undefined,
    {},
    { 'Which deployment target?': [] },
  ])('rejects incomplete question answers: %j', (answers) => {
    expect(PromptResponse.safeParse({ action: 'answer', answers }).success).toBe(false);
  });

  it('continues to accept permission responses without answers', () => {
    expect(PromptResponse.safeParse({ action: 'allow' }).success).toBe(true);
  });
});
