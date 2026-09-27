import { afterEach, describe, expect, it } from 'vitest';
import { getAccountRefreshMs, isOpenAIAllowanceSourceEnabled, isProviderAllowancesEnabled } from './providerAllowances.js';

describe('provider allowance rollout configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const name of ['PROVIDER_ALLOWANCES_ENABLED', 'PROVIDER_ALLOWANCES_OPENAI', 'PROVIDER_ALLOWANCE_STREAM_STALE_MS']) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });

  it.each([undefined, '', 'true', 'TRUE', 'yes', '0', 'false'])('defaults to disabled and rejects %j', (value) => {
    if (value === undefined) delete process.env.PROVIDER_ALLOWANCES_ENABLED;
    else process.env.PROVIDER_ALLOWANCES_ENABLED = value;
    expect(isProviderAllowancesEnabled()).toBe(false);
  });

  it('accepts only PROVIDER_ALLOWANCES_ENABLED=1 as the explicit opt-in', () => {
    process.env.PROVIDER_ALLOWANCES_ENABLED = '1';
    expect(isProviderAllowancesEnabled()).toBe(true);
  });

  it('enables the OpenAI source only when the master gate and its own sub-flag are both on', () => {
    delete process.env.PROVIDER_ALLOWANCES_ENABLED;
    delete process.env.PROVIDER_ALLOWANCES_OPENAI;
    expect(isOpenAIAllowanceSourceEnabled()).toBe(false);

    process.env.PROVIDER_ALLOWANCES_ENABLED = '1';
    expect(isOpenAIAllowanceSourceEnabled()).toBe(false);

    process.env.PROVIDER_ALLOWANCES_OPENAI = '1';
    expect(isOpenAIAllowanceSourceEnabled()).toBe(true);

    process.env.PROVIDER_ALLOWANCES_OPENAI = 'true';
    expect(isOpenAIAllowanceSourceEnabled()).toBe(false);

    delete process.env.PROVIDER_ALLOWANCES_ENABLED;
    process.env.PROVIDER_ALLOWANCES_OPENAI = '1';
    expect(isOpenAIAllowanceSourceEnabled()).toBe(false);
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
