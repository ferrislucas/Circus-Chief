import { describe, expect, it, vi } from 'vitest';
import { notifyAllowanceListChangedAfterMutation } from './providerAllowanceServiceInstance.js';

describe('notifyAllowanceListChangedAfterMutation', () => {
  it('awaits the invalidation exactly once and stays silent on success', async () => {
    const invalidator = vi.fn(() => Promise.resolve());
    const logger = { warn: vi.fn(), log: vi.fn() };

    await notifyAllowanceListChangedAfterMutation({ invalidator, logger });

    expect(invalidator).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('surfaces a failing broadcast as a credential-free diagnostic instead of a silent swallow', async () => {
    const failure = new Error('socket hang up');
    failure.code = 'ECONNRESET';
    const invalidator = vi.fn(() => Promise.reject(failure));
    const logger = { warn: vi.fn(), log: vi.fn() };

    // Must not throw: persistence already succeeded, so the mutation
    // response must still go out — but the failure stays visible in logs.
    await notifyAllowanceListChangedAfterMutation({ invalidator, logger });

    expect(invalidator).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [tag, diagnostic] = logger.warn.mock.calls[0];
    expect(tag).toContain('ProviderAllowances');
    expect(diagnostic).toContain('list-invalidation-failed');
    expect(diagnostic).toContain('ECONNRESET');
  });

  it('never leaks credential-like values into the diagnostic', async () => {
    const failure = new Error('broadcast failed with token sk-live-secret-value');
    const invalidator = vi.fn(() => Promise.reject(failure));
    const logger = { warn: vi.fn(), log: vi.fn() };

    await notifyAllowanceListChangedAfterMutation({ invalidator, logger });

    const logged = logger.warn.mock.calls.map((args) => args.join(' ')).join(' ');
    expect(logged).not.toContain('sk-live-secret-value');
  });
});
