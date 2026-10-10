import { describe, expect, it } from 'vitest';
import { getStreamStaleAfterMs } from '../../config/providerAllowances.js';
import { MUSE_PROBE_DEFAULT_MODEL, mapMuseUsageChanged } from './museUsageMapper.js';

// Sanitized fixtures of the validated MSP `SubscriptionUsage` shape
// (FRD §2): `{observedAtMs, tier, weekly {resetsAtMs, usedPercent}, window
// {resetsAtMs, usedPercent, windowDurationMins}}`. No credentials, tier ids,
// or account identifiers are recorded — only the measurement shape.
function usageFixture(overrides = {}) {
  return {
    observedAtMs: 1_789_855_000_000,
    tier: 'sanitized-tier',
    window: { resetsAtMs: 1_789_860_000_000, usedPercent: 17, windowDurationMins: 300 },
    weekly: { resetsAtMs: 1_789_940_000_000, usedPercent: 83 },
    ...overrides,
  };
}

describe('mapMuseUsageChanged', () => {
  it('maps both windows to remaining percentages with resets', () => {
    const candidate = mapMuseUsageChanged(usageFixture(), { observedAt: 1_000, streamStaleMs: 60_000 });

    expect(candidate).toEqual({
      providerKind: 'meta',
      source: 'provider',
      updatedAt: 1_789_855_000_000,
      staleAfterMs: 60_000,
      allowances: [
        {
          key: 'window', label: '5-hour window', remaining: null, limit: null,
          remainingPercent: 83, unit: 'other', resetsAt: 1_789_860_000_000,
        },
        {
          key: 'weekly', label: 'Weekly window', remaining: null, limit: null,
          remainingPercent: 17, unit: 'other', resetsAt: 1_789_940_000_000,
        },
      ],
    });
  });

  it('derives staleness from the shared stream-freshness config by default', () => {
    const candidate = mapMuseUsageChanged(usageFixture());
    expect(candidate.staleAfterMs).toBe(getStreamStaleAfterMs());
  });

  it('clamps over-quota usage above 100 percent to zero remaining', () => {
    const candidate = mapMuseUsageChanged(usageFixture({
      window: { resetsAtMs: 1_789_860_000_000, usedPercent: 137 },
    }));
    expect(candidate.allowances).toHaveLength(2);
    expect(candidate.allowances[0]).toMatchObject({ key: 'window', remainingPercent: 0 });
  });

  it('yields the surviving allowance when a window is missing', () => {
    const { weekly, ...withoutWeekly } = usageFixture();
    expect(mapMuseUsageChanged(withoutWeekly).allowances.map((a) => a.key)).toEqual(['window']);

    const { window, ...withoutWindow } = usageFixture();
    expect(mapMuseUsageChanged(withoutWindow).allowances.map((a) => a.key)).toEqual(['weekly']);
    expect(weekly).toBeDefined();
    expect(window).toBeDefined();
  });

  it('maps truthfully absent usage to null', () => {
    expect(mapMuseUsageChanged({})).toBeNull();
    expect(mapMuseUsageChanged({ observedAtMs: 1_789_855_000_000 })).toBeNull();
  });

  it.each([
    ['null', null],
    ['a string', 'usage'],
    ['a number', 42],
    ['an array', []],
  ])('maps non-object usage %s to null', (_label, usage) => {
    expect(mapMuseUsageChanged(usage)).toBeNull();
  });

  it.each([
    ['a string percent', { usedPercent: '17' }],
    ['a NaN percent', { usedPercent: NaN }],
    ['a negative percent', { usedPercent: -3 }],
    ['a missing percent', {}],
    ['a non-object window', 'window'],
  ])('maps malformed window percentages (%s) to null', (_label, window) => {
    expect(mapMuseUsageChanged(usageFixture({ window }))).toBeNull();
  });

  it.each([
    ['negative window reset', { window: { resetsAtMs: -5, usedPercent: 17 } }],
    ['zero weekly reset', { weekly: { resetsAtMs: 0, usedPercent: 83 } }],
    ['non-numeric window reset', { window: { resetsAtMs: 'soon', usedPercent: 17 } }],
  ])('maps invalid resets (%s) to null', (_label, overrides) => {
    expect(mapMuseUsageChanged(usageFixture(overrides))).toBeNull();
  });

  it('keeps an allowance with a null reset when the reset is absent', () => {
    const candidate = mapMuseUsageChanged(usageFixture({
      window: { usedPercent: 17 },
    }));
    expect(candidate.allowances).toHaveLength(2);
    expect(candidate.allowances[0]).toMatchObject({ key: 'window', remainingPercent: 83, resetsAt: null });
  });

  it('never emits the tier id in any output', () => {
    const candidate = mapMuseUsageChanged(usageFixture());
    expect(JSON.stringify(candidate)).not.toContain('sanitized-tier');
    for (const allowance of candidate.allowances) {
      expect(allowance).not.toHaveProperty('tier');
    }
    expect(candidate).not.toHaveProperty('tier');
  });

  it('falls back to the observation time when observedAtMs is absent', () => {
    const { observedAtMs, ...withoutObserved } = usageFixture();
    expect(observedAtMs).toBeDefined();
    expect(mapMuseUsageChanged(withoutObserved, { observedAt: 1_000 }).updatedAt).toBe(1_000);
  });

  it('defaults the probe model to the non-contributor Muse model', () => {
    expect(MUSE_PROBE_DEFAULT_MODEL).toBe('muse-spark-1.3');
  });
});
