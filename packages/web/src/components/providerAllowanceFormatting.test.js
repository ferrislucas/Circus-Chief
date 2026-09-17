import { describe, expect, it, vi } from 'vitest';
import { formatAllowance, formatRelativeTime, sourceLabel } from './providerAllowanceFormatting.js';

describe('provider allowance formatting', () => {
  it('formats honest quantity and percentage values', () => {
    expect(formatAllowance({ remainingPercent: 25, remaining: null, limit: null })).toBe('25% remaining');
    expect(formatAllowance({ remainingPercent: null })).toBe('Unknown');
  });

  it('maps provenance and expresses timestamps relative to the supplied clock', () => {
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    expect(sourceLabel('observed-header')).toBe('Observed from provider response headers');
    expect(formatRelativeTime('2026-01-02T12:00:00Z')).toBe('in 2 hours');
    expect(formatRelativeTime('2026-01-02T09:30:00Z')).toBe('30 minutes ago');
  });
});
