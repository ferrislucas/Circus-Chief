import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapZaiQuota } from './zaiAllowanceMapper.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'zai', 'quota-limit.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const observedAt = 1_789_855_000_000;

describe('zaiAllowanceMapper', () => {
  it('maps TOKENS_LIMIT unit 3/6 rows to absolute token allowances', () => {
    expect(mapZaiQuota(fixture.payload, { observedAt })).toEqual({
      providerKind: 'anthropic',
      source: 'provider',
      updatedAt: observedAt,
      staleAfterMs: 10 * 60_000,
      allowances: [
        {
          key: 'five_hour',
          label: '5-hour token window',
          remaining: 66_000_000,
          limit: 120_000_000,
          remainingPercent: null, // derived by the service from absolutes
          unit: 'tokens',
          resetsAt: 1_737_285_600_000,
        },
        {
          key: 'weekly',
          label: 'Weekly token window',
          remaining: 480_000_000,
          limit: 600_000_000,
          remainingPercent: null,
          unit: 'tokens',
          resetsAt: 1_737_372_000_000,
        },
      ],
    });
  });

  it('filters TIME_LIMIT rows and unknown token units', () => {
    const candidate = mapZaiQuota(fixture.payload, { observedAt });

    // unit 9 and the TIME_LIMIT row are absent.
    expect(candidate.allowances.map((row) => row.key)).toEqual(['five_hour', 'weekly']);
    expect(JSON.stringify(candidate)).not.toContain('usageDetails');
  });

  it('falls back to the percentage-only path when absolutes are absent', () => {
    expect(mapZaiQuota(fixture.percentageOnlyPayload, { observedAt })).toMatchObject({
      allowances: [{ remaining: null, limit: null, remainingPercent: 30 }],
    });
  });

  it('keeps a percentage-only row with out-of-range utilization by clamping to exhausted zero', () => {
    const candidate = mapZaiQuota(
      { data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 104 }] } },
      { observedAt },
    );

    expect(candidate.allowances).toEqual([
      expect.objectContaining({ key: 'five_hour', remaining: null, limit: null, remainingPercent: 0 }),
    ]);
  });

  it('returns null for payloads without usable rows', () => {
    expect(mapZaiQuota(null, { observedAt })).toBeNull();
    expect(mapZaiQuota({}, { observedAt })).toBeNull();
    expect(mapZaiQuota({ data: { limits: [] } }, { observedAt })).toBeNull();
    expect(mapZaiQuota({ data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3 }] } }, { observedAt })).toBeNull();
  });

  it('honors a caller-supplied freshness window', () => {
    const candidate = mapZaiQuota(fixture.payload, { observedAt, staleAfterMs: 60_000 });

    expect(candidate.staleAfterMs).toBe(60_000);
  });
});
