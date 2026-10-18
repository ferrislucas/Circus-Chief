import { describe, it, expect } from 'vitest';
import { formatTierDegradedNotice } from './tierDegradedNotice.js';

describe('formatTierDegradedNotice', () => {
  it('names the degraded tier when known', () => {
    expect(formatTierDegradedNotice({ tierName: 'Gold', degradedFrom: 'tier::abc' }))
      .toBe('Model tier "Gold" changed and this session was moved to a concrete model.');
  });

  it('falls back to a generic label without a name', () => {
    expect(formatTierDegradedNotice({ tierName: null, degradedFrom: 'tier::abc' }))
      .toBe('A model tier changed and this session was moved to a concrete model.');
  });

  it('handles a missing payload', () => {
    expect(formatTierDegradedNotice(null))
      .toBe('A model tier changed and this session was moved to a concrete model.');
  });
});
