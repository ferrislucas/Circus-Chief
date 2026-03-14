import { describe, it, expect, vi } from 'vitest';
import { createConcurrencyGuard } from './withConcurrencyGuard.js';

describe('withConcurrencyGuard', () => {
  describe('createConcurrencyGuard', () => {
    it('returns an object with run, cleanup, activeGenerations, and pendingRegenerations', () => {
      const guard = createConcurrencyGuard();
      expect(typeof guard.run).toBe('function');
      expect(typeof guard.cleanup).toBe('function');
      expect(guard.activeGenerations).toBeInstanceOf(Map);
      expect(guard.pendingRegenerations).toBeInstanceOf(Set);
    });
  });

  describe('run', () => {
    it('executes the function and returns its result', async () => {
      const guard = createConcurrencyGuard();
      const result = await guard.run('key-1', async () => 'result-value');
      expect(result).toBe('result-value');
    });

    it('tracks active generation during execution', async () => {
      const guard = createConcurrencyGuard();
      let wasActive = false;
      let resolvePromise;

      const runPromise = guard.run('key-1', () => {
        return new Promise((resolve) => { resolvePromise = resolve; });
      });

      // After fn() is called and promise is stored, check if key is tracked
      // Need to yield to let the microtask run
      await new Promise((r) => setTimeout(r, 0));
      wasActive = guard.activeGenerations.has('key-1');

      // Resolve the inner promise
      resolvePromise('done');
      await runPromise;

      expect(wasActive).toBe(true);
      expect(guard.activeGenerations.has('key-1')).toBe(false); // Cleaned up after
    });

    it('coalesces concurrent calls for the same key', async () => {
      const guard = createConcurrencyGuard();
      let callCount = 0;
      let resolveFirst;

      const firstPromise = guard.run('key-1', () => {
        callCount++;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      });

      // Second call while first is in-flight
      const secondPromise = guard.run('key-1', () => {
        callCount++;
        return Promise.resolve('second');
      });

      // Both should return the same promise (coalesced)
      resolveFirst('first');
      const [result1, result2] = await Promise.all([firstPromise, secondPromise]);

      // Only the first function should have been called
      // The second was coalesced (its fn never ran), so callCount should be 1
      expect(callCount).toBe(1);
      expect(result1).toBe('first');
      expect(result2).toBe('first'); // Coalesced to first's result
    });

    it('schedules follow-up when concurrent call is coalesced', async () => {
      const guard = createConcurrencyGuard();
      const onFollowUp = vi.fn();
      let resolveFirst;

      const firstPromise = guard.run(
        'key-1',
        () => new Promise((resolve) => { resolveFirst = resolve; }),
        { onFollowUp }
      );

      // Second call while first is in-flight (triggers pending regeneration)
      guard.run('key-1', () => Promise.resolve('second'), { onFollowUp });

      // Complete the first call
      resolveFirst('first');
      await firstPromise;

      // Follow-up should have been called
      expect(onFollowUp).toHaveBeenCalledWith('key-1');
    });

    it('bypasses concurrency guard when bypass option is true', async () => {
      const guard = createConcurrencyGuard();
      let callCount = 0;
      let resolveFirst;

      // Start first run
      guard.run('key-1', () => {
        callCount++;
        return new Promise((resolve) => { resolveFirst = resolve; });
      });

      // Second call with bypass=true should create a new concurrent execution
      const secondPromise = guard.run(
        'key-1',
        async () => {
          callCount++;
          return 'bypassed';
        },
        { bypass: true }
      );

      resolveFirst('first');
      const result = await secondPromise;

      expect(result).toBe('bypassed');
      expect(callCount).toBe(2); // Both functions were called
    });

    it('handles errors from the function', async () => {
      const guard = createConcurrencyGuard();

      await expect(
        guard.run('key-1', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Guard should be cleaned up after error
      expect(guard.activeGenerations.has('key-1')).toBe(false);
    });

    it('still schedules follow-up after error', async () => {
      const guard = createConcurrencyGuard();
      const onFollowUp = vi.fn();
      let rejectFirst;

      const firstPromise = guard.run(
        'key-1',
        () => new Promise((_resolve, reject) => { rejectFirst = reject; }),
        { onFollowUp }
      );

      // Second call while first is in-flight - coalesces into pending
      const secondPromise = guard.run('key-1', () => Promise.resolve('second'), { onFollowUp });

      // First call fails - need to handle both promise rejections
      rejectFirst(new Error('fail'));

      // Catch both promises (second is coalesced to first, both reject)
      await Promise.allSettled([firstPromise, secondPromise]);

      // Follow-up should still be called even after error
      expect(onFollowUp).toHaveBeenCalledWith('key-1');
    });

    it('allows different keys to run concurrently', async () => {
      const guard = createConcurrencyGuard();
      let key1Active = false;
      let key2Active = false;
      let resolveKey1;

      guard.run('key-1', () => {
        key1Active = true;
        return new Promise((resolve) => { resolveKey1 = resolve; });
      });

      const key2Result = await guard.run('key-2', async () => {
        key2Active = true;
        // key-1 should still be active while key-2 runs
        return guard.activeGenerations.has('key-1');
      });

      expect(key1Active).toBe(true);
      expect(key2Active).toBe(true);
      expect(key2Result).toBe(true); // key-1 was still active during key-2

      resolveKey1('done');
    });
  });

  describe('cleanup', () => {
    it('removes pending regeneration for a key', () => {
      const guard = createConcurrencyGuard();
      guard.pendingRegenerations.add('key-1');

      guard.cleanup('key-1');

      expect(guard.pendingRegenerations.has('key-1')).toBe(false);
    });

    it('does nothing for non-existent key', () => {
      const guard = createConcurrencyGuard();
      expect(() => guard.cleanup('non-existent')).not.toThrow();
    });
  });
});
