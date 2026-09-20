import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapCodexRateLimits } from './codexRolloutAllowanceExtractor.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'codex', 'rollout-token-count.jsonl',
);
const observedAt = 1_789_855_000_000;

function rateLimitsFromFixture() {
  const tokenCountLine = fs.readFileSync(fixturePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .find((event) => event?.payload?.type === 'token_count' && event.payload.rate_limits);
  return tokenCountLine.payload.rate_limits;
}

describe('codexRolloutAllowanceExtractor', () => {
  it('maps the sanitized real-shape RateLimitSnapshot to 5-hour and weekly rows', () => {
    expect(mapCodexRateLimits(rateLimitsFromFixture(), { observedAt })).toEqual({
      providerKind: 'openai',
      source: 'provider',
      updatedAt: observedAt,
      staleAfterMs: 15 * 60_000,
      allowances: [
        {
          key: 'five_hour',
          label: '5-hour window',
          remaining: null,
          limit: null,
          remainingPercent: 83,
          unit: 'tokens',
          resetsAt: 1_789_856_117_000, // unix seconds → ms
        },
        {
          key: 'weekly',
          label: 'Weekly window',
          remaining: null,
          limit: null,
          remainingPercent: 17,
          unit: 'tokens',
          resetsAt: 1_789_959_005_000,
        },
      ],
    });
  });

  it('returns null for missing or measurement-less snapshots', () => {
    expect(mapCodexRateLimits(null, { observedAt })).toBeNull();
    expect(mapCodexRateLimits({}, { observedAt })).toBeNull();
    expect(mapCodexRateLimits({ primary: { used_percent: 'NaN' } }, { observedAt })).toBeNull();
  });

  it('keeps one-sided windows when only the primary window is present', () => {
    const candidate = mapCodexRateLimits({ primary: { used_percent: 40, resets_at: 1_789_856_117 } }, { observedAt });

    expect(candidate.allowances).toEqual([
      expect.objectContaining({ key: 'five_hour', remainingPercent: 60 }),
    ]);
  });

  it('rejects out-of-range used_percent as untrusted and honors a caller freshness window', () => {
    const candidate = mapCodexRateLimits(
      { primary: { used_percent: 140, resets_at: 1_789_856_117 } },
      { observedAt, streamStaleMs: 60_000 },
    );

    expect(candidate.staleAfterMs).toBe(60_000);
    expect(candidate.allowances[0]).toMatchObject({ remainingPercent: null });
  });

  it('drops plan_type and credits account metadata', () => {
    const snapshot = { ...rateLimitsFromFixture(), plan_type: 'plus', credits: { balance: '0' } };
    const serialized = JSON.stringify(mapCodexRateLimits(snapshot, { observedAt }));

    expect(serialized).not.toContain('plan_type');
    expect(serialized).not.toContain('credits');
    expect(serialized).not.toContain('plus');
  });
});
