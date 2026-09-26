import { describe, expect, it, vi } from 'vitest';
import { formatAllowance, formatRelativeTime, sourceLabel } from './providerAllowanceFormatting.js';

describe('provider allowance formatting', () => {
  it('formats honest quantity and percentage values', () => {
    expect(formatAllowance({ remainingPercent: 25, remaining: null, limit: null })).toBe('25% remaining');
    expect(formatAllowance({ remainingPercent: null })).toBe('Unknown');
  });

  it('formats used values as used of limit without provider-specific inference', () => {
    expect(formatAllowance({ value: 54_000_000, valueKind: 'used', limit: 120_000_000, unit: 'tokens', remainingPercent: 55 })).toBe('54M tokens used of 120M');
    expect(formatAllowance({ value: 66_000_000, valueKind: 'remaining', limit: 120_000_000, unit: 'tokens', remainingPercent: 55 })).toBe('66M tokens remaining of 120M');
  });

  it('maps provenance and expresses timestamps relative to the supplied clock', () => {
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    expect(sourceLabel('observed-header')).toBe('Observed from provider response headers');
    expect(formatRelativeTime('2026-01-02T12:00:00Z')).toBe('in 2 hours');
    expect(formatRelativeTime('2026-01-02T09:30:00Z')).toBe('30 minutes ago');
  });
});
