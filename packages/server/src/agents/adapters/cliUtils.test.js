import { describe, it, expect } from 'vitest';
import { composeCliPrompt } from './cliUtils.js';

describe('composeCliPrompt', () => {
  it('composes prompt with system prompt and user prompt', () => {
    const result = composeCliPrompt('Be helpful', 'Hello');
    expect(result).toBe('SYSTEM PROMPT:\nBe helpful\n\nUSER:\nHello');
  });

  it('returns user prompt only when systemPrompt is null', () => {
    const result = composeCliPrompt(null, 'Hello');
    expect(result).toBe('Hello');
  });

  it('returns user prompt only when systemPrompt is undefined', () => {
    const result = composeCliPrompt(undefined, 'Hello');
    expect(result).toBe('Hello');
  });

  it('returns user prompt only when systemPrompt is empty string', () => {
    const result = composeCliPrompt('', 'Hello');
    expect(result).toBe('Hello');
  });

  it('handles null prompt with system prompt', () => {
    const result = composeCliPrompt('sys', null);
    expect(result).toBe('SYSTEM PROMPT:\nsys\n\nUSER:\n');
  });

  it('returns empty string when both are null', () => {
    const result = composeCliPrompt(null, null);
    expect(result).toBe('');
  });
});
