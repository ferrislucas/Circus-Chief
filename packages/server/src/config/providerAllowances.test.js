import { afterEach, describe, expect, it } from 'vitest';
import { isProviderAllowancesEnabled } from './providerAllowances.js';

describe('provider allowance rollout configuration', () => {
  const original = process.env.PROVIDER_ALLOWANCES_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.PROVIDER_ALLOWANCES_ENABLED;
    else process.env.PROVIDER_ALLOWANCES_ENABLED = original;
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
});
