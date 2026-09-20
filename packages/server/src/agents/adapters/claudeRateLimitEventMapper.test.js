import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapClaudeRateLimitEvent } from './claudeRateLimitEventMapper.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'claude', 'rate-limit-event.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const observedAt = 1_789_895_000_000;

describe('claudeRateLimitEventMapper', () => {
  it('maps the sanitized real-shape five-hour payload to a percentage-only allowance', () => {
    expect(mapClaudeRateLimitEvent(fixture.fiveHourWithUtilization.rate_limit_info, { observedAt })).toEqual({
      providerKind: 'anthropic',
      source: 'provider',
      updatedAt: observedAt,
      staleAfterMs: 15 * 60_000,
      status: 'available',
      allowances: [{
        key: 'five_hour',
        label: '5-hour window',
        remaining: null,
        limit: null,
        remainingPercent: 57.5,
        unit: 'tokens',
        resetsAt: 1_789_900_000_000,
      }],
    });
  });

  it.each([
    ['five_hour', '5-hour window'],
    ['seven_day', 'Weekly window'],
    ['seven_day_opus', 'Weekly Opus window'],
    ['seven_day_sonnet', 'Weekly Sonnet window'],
  ])('maps each per-model window rate limit type %s', (rateLimitType, label) => {
    const candidate = mapClaudeRateLimitEvent({ status: 'allowed', rateLimitType, utilization: 0, resetsAt: 1_789_900_000 }, { observedAt });

    expect(candidate.allowances).toEqual([expect.objectContaining({ key: rateLimitType, label, remainingPercent: 100 })]);
  });

  it('keeps per-model weekly caps as separate rows for separate observation', () => {
    const opus = mapClaudeRateLimitEvent(fixture.weeklyOpusCap.rate_limit_info, { observedAt });
    const sonnet = mapClaudeRateLimitEvent(fixture.weeklySonnetCap.rate_limit_info, { observedAt });

    expect(opus.allowances[0]).toMatchObject({ key: 'seven_day_opus', remainingPercent: 12 });
    expect(sonnet.allowances[0]).toMatchObject({ key: 'seven_day_sonnet', remainingPercent: 87.75 });
    expect(opus.status).toBe('warning');
  });

  it('maps status without utilization to a status hint and fabricates no percentage', () => {
    expect(mapClaudeRateLimitEvent(fixture.statusOnlyRejected.rate_limit_info, { observedAt })).toMatchObject({
      status: 'exhausted',
      allowances: [{ remainingPercent: null, resetsAt: 1_789_900_000_000 }],
    });
  });

  it.each([
    ['allowed', 'available'],
    ['allowed_warning', 'warning'],
    ['rejected', 'exhausted'],
  ])('maps provider status %s to contract status %s', (status, hint) => {
    expect(mapClaudeRateLimitEvent({ status, resetsAt: 1_789_900_000 }, { observedAt }).status).toBe(hint);
  });

  it('drops the overage rate-limit family (deferred)', () => {
    expect(mapClaudeRateLimitEvent(fixture.overageDeferred.rate_limit_info, { observedAt })).toBeNull();
  });

  it.each([
    ['out-of-range utilization above 100', { status: 'allowed', utilization: 140, resetsAt: 1_789_900_000 }, { status: 'available', allowances: [expect.objectContaining({ remainingPercent: null, resetsAt: 1_789_900_000_000 })] }],
    ['out-of-range utilization below 0', { status: 'allowed', utilization: -5 }, { status: 'available', allowances: [expect.objectContaining({ remainingPercent: null })] }],
    ['NaN utilization with a status', { status: 'allowed', utilization: Number.NaN }, { status: 'available', allowances: [expect.objectContaining({ remainingPercent: null })] }],
    ['unknown status without utilization', { status: 'mystery' }, null],
    ['empty payload', {}, null],
    ['non-object payload', null, null],
  ])('treats %s honestly', (_name, info, expected) => {
    const candidate = mapClaudeRateLimitEvent(info, { observedAt });
    if (expected === null) {
      expect(candidate).toBeNull();
    } else {
      expect(candidate).toMatchObject(expected);
    }
  });

  it('honors a caller-supplied stream freshness window', () => {
    const candidate = mapClaudeRateLimitEvent(fixture.fiveHourWithUtilization.rate_limit_info, { observedAt, streamStaleMs: 60_000 });

    expect(candidate.staleAfterMs).toBe(60_000);
  });
});
