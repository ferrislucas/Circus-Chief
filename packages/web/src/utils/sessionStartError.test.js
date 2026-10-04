import { describe, it, expect } from 'vitest';
import { formatSessionStartError, isTierExhaustedError } from './sessionStartError.js';

describe('isTierExhaustedError', () => {
  it('detects the exhausted-tier code', () => {
    expect(isTierExhaustedError({ code: 'MODEL_TIER_EXHAUSTED' })).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isTierExhaustedError({ code: 'GIT_TIMEOUT' })).toBe(false);
    expect(isTierExhaustedError(new Error('boom'))).toBe(false);
    expect(isTierExhaustedError(null)).toBe(false);
  });
});

describe('formatSessionStartError', () => {
  it('names the tier when available', () => {
    const message = formatSessionStartError({
      code: 'MODEL_TIER_EXHAUSTED',
      tierName: 'Gold',
      message: 'raw server message',
    });
    expect(message).toContain('"Gold"');
    expect(message).not.toBe('raw server message');
  });

  it('falls back to a generic tier label without a name', () => {
    const message = formatSessionStartError({ code: 'MODEL_TIER_EXHAUSTED', message: 'raw' });
    expect(message).toContain('model tier');
  });

  it('passes through ordinary errors untouched', () => {
    expect(formatSessionStartError(new Error('disk exploded'))).toBe('disk exploded');
  });
});
