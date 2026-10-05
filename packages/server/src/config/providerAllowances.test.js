import { afterEach, describe, expect, it } from 'vitest';
import { getAccountRefreshMs, getStreamStaleAfterMs } from './providerAllowances.js';

describe('provider allowance freshness tuning', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const name of ['PROVIDER_ALLOWANCE_STREAM_STALE_MS']) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });

  it('defaults the stream stale window to 15 minutes and rejects garbage', () => {
    delete process.env.PROVIDER_ALLOWANCE_STREAM_STALE_MS;
    expect(getStreamStaleAfterMs()).toBe(900_000);

    process.env.PROVIDER_ALLOWANCE_STREAM_STALE_MS = 'garbage';
    expect(getStreamStaleAfterMs()).toBe(900_000);

    process.env.PROVIDER_ALLOWANCE_STREAM_STALE_MS = '30000';
    expect(getStreamStaleAfterMs()).toBe(30_000);
  });

  it.each([
    [undefined, 60_000],
    ['900000', 60_000],
    ['120000', 60_000],
    ['30000', 15_000],
    ['10000', 5_000],
    ['0', 1_000],
    ['garbage', 60_000],
  ])('derives the account refresh cadence from staleness window %j as %j', (staleMs, expected) => {
    if (staleMs === undefined) delete process.env.PROVIDER_ALLOWANCE_STREAM_STALE_MS;
    else process.env.PROVIDER_ALLOWANCE_STREAM_STALE_MS = staleMs;
    expect(getAccountRefreshMs()).toBe(expected);
  });
});
