import { describe, expect, it, vi } from 'vitest';
import { mapGrokBilling, observeGrokBilling } from './grokBilling.js';

describe('grok billing allowance', () => {
  it('maps a credit-usage percent without inventing a credit balance', () => {
    const candidate = mapGrokBilling({
      config: { creditUsagePercent: 20, currentPeriod: { end: '2026-06-01T00:00:00.000Z' } },
    }, { observedAt: 5, staleAfterMs: 10 });
    expect(candidate).toMatchObject({
      providerKind: 'xai',
      source: 'provider',
      updatedAt: 5,
      allowances: [{
        remaining: null,
        limit: null,
        remainingPercent: 80,
        unit: 'other',
        resetsAt: Date.parse('2026-06-01T00:00:00.000Z'),
      }],
    });
  });

  it('maps included credits against the monthly limit', () => {
    const candidate = mapGrokBilling({
      monthlyLimit: { val: 100 },
      usage: { includedUsed: { val: 25 }, totalUsed: { val: 25 } },
      billingCycle: { billingPeriodEnd: '2026-06-01T00:00:00.000Z' },
    });
    expect(candidate.allowances[0]).toMatchObject({
      remaining: 75,
      limit: 100,
      remainingPercent: 75,
      unit: 'credits',
    });
  });

  it('rejects an unrecognized payload', () => {
    expect(mapGrokBilling({ hello: 'nope' })).toBeNull();
    expect(mapGrokBilling(null)).toBeNull();
  });

  it('swallows a missing billing method', async () => {
    const observer = vi.fn();
    const client = {
      child: { stdin: {} },
      request: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: -32601 })),
    };
    await observeGrokBilling(client, { observer, providerId: 'xai-default', clock: { now: () => 1 } });
    expect(client.request).toHaveBeenCalledWith('_x.ai/billing', {}, 3000);
    expect(observer).not.toHaveBeenCalled();
  });
});
