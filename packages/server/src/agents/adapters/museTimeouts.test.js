import { describe, it, expect } from 'vitest';
import { deadline, MuseTurnTimeoutError, DEFAULT_TIMEOUTS } from './museTimeouts.js';

describe('deadline (finding #12a)', () => {
  it('rejects with MuseTurnTimeoutError when called without a context', async () => {
    const never = new Promise(() => {});
    await expect(deadline(never, { timeoutMs: 20, phase: 'spawn' }))
      .rejects.toMatchObject({ code: 'MUSE_TURN_TIMEOUT', phase: 'spawn', name: 'MuseTurnTimeoutError' });
  });

  it('rejects with MuseTurnTimeoutError when called with a context-less options object', async () => {
    const never = new Promise(() => {});
    await expect(deadline(never, { timeoutMs: 20, phase: 'resume', onTimeout: () => {} }))
      .rejects.toBeInstanceOf(MuseTurnTimeoutError);
  });

  it('resolves normally when the promise beats the budget', async () => {
    await expect(deadline(Promise.resolve('ok'), { timeoutMs: 1000, phase: 'spawn' }))
      .resolves.toBe('ok');
  });

  it('keeps every default budget bounded', () => {
    expect(DEFAULT_TIMEOUTS.startupMs).toBeLessThanOrEqual(30_000);
    expect(DEFAULT_TIMEOUTS.approvalPromptMs).toBeLessThanOrEqual(DEFAULT_TIMEOUTS.turnMs);
  });
});
