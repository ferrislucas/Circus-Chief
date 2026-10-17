import { describe, it, expect } from 'vitest';
import { resolveQuotaResetHint, EXHAUSTED_REMAINING_THRESHOLD } from './quotaResetHint.js';

const NOW = 1_700_000_000_000;

function allowance(overrides = {}) {
  return {
    key: 'five_hour',
    label: '5-hour window',
    remainingPercent: 0,
    resetsAt: NOW + 60_000,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    providerId: 'anthropic-default',
    allowances: [allowance()],
    staleAt: null,
    ...overrides,
  };
}

describe('resolveQuotaResetHint', () => {
  it('exposes a zero exhaustion threshold', () => {
    expect(EXHAUSTED_REMAINING_THRESHOLD).toBe(0);
  });

  it('returns null for null, non-object, and empty snapshots', () => {
    expect(resolveQuotaResetHint(null, NOW)).toBeNull();
    expect(resolveQuotaResetHint(undefined, NOW)).toBeNull();
    expect(resolveQuotaResetHint('snapshot', NOW)).toBeNull();
    expect(resolveQuotaResetHint({}, NOW)).toBeNull();
  });

  it('returns null when allowances are missing, non-array, or all malformed', () => {
    expect(resolveQuotaResetHint(snapshot({ allowances: undefined }), NOW)).toBeNull();
    expect(resolveQuotaResetHint(snapshot({ allowances: 'x' }), NOW)).toBeNull();
    expect(resolveQuotaResetHint(snapshot({ allowances: [] }), NOW)).toBeNull();
    expect(resolveQuotaResetHint(snapshot({ allowances: [{ nope: true }] }), NOW)).toBeNull();
  });

  it('returns null for a stale snapshot even with an exhausted window and future reset', () => {
    expect(resolveQuotaResetHint(snapshot({ staleAt: NOW - 1 }), NOW)).toBeNull();
    expect(resolveQuotaResetHint(snapshot({ staleAt: NOW }), NOW)).toBeNull();
  });

  it('returns null when no windows are exhausted', () => {
    const snap = snapshot({
      allowances: [allowance({ remainingPercent: 42, resetsAt: NOW + 60_000 })],
    });
    expect(resolveQuotaResetHint(snap, NOW)).toBeNull();
  });

  it('returns the resetsAt of a single exhausted window', () => {
    expect(resolveQuotaResetHint(snapshot(), NOW)).toEqual({ resetsAt: NOW + 60_000 });
  });

  it('returns null when the exhausted window has no valid reset', () => {
    expect(resolveQuotaResetHint(snapshot({ allowances: [allowance({ resetsAt: null })] }), NOW)).toBeNull();
  });

  it('returns null for a past resetsAt instead of firing immediately', () => {
    const snap = snapshot({ allowances: [allowance({ resetsAt: NOW - 1 })] });
    expect(resolveQuotaResetHint(snap, NOW)).toBeNull();
  });

  it('returns the max resetsAt across multiple exhausted windows', () => {
    const snap = snapshot({
      allowances: [
        allowance({ key: 'five_hour', resetsAt: NOW + 60_000 }),
        allowance({ key: 'weekly', resetsAt: NOW + 3_600_000 }),
      ],
    });
    expect(resolveQuotaResetHint(snap, NOW)).toEqual({ resetsAt: NOW + 3_600_000 });
  });

  it('ignores healthy windows alongside exhausted ones', () => {
    const snap = snapshot({
      allowances: [
        allowance({ key: 'weekly', label: 'Weekly', remainingPercent: 80, resetsAt: NOW + 86_400_000 }),
        allowance({ key: 'five_hour', resetsAt: NOW + 60_000 }),
      ],
    });
    expect(resolveQuotaResetHint(snap, NOW)).toEqual({ resetsAt: NOW + 60_000 });
  });

  it('treats resetsAt equal to now as not future', () => {
    const snap = snapshot({ allowances: [allowance({ resetsAt: NOW })] });
    expect(resolveQuotaResetHint(snap, NOW)).toBeNull();
  });

  it('never treats a null remainingPercent as exhausted', () => {
    const snap = snapshot({
      allowances: [allowance({ remainingPercent: null, resetsAt: NOW + 60_000 })],
    });
    expect(resolveQuotaResetHint(snap, NOW)).toBeNull();
  });
});
