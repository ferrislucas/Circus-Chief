import { describe, it, expect, beforeEach } from 'vitest';
import { acquireBranchLock, hasBranchLock, clearAllLocks } from './branchMutex.js';

describe('branchMutex', () => {
  beforeEach(() => {
    clearAllLocks();
  });

  describe('acquireBranchLock', () => {
    it('acquires a lock for a project', async () => {
      const release = await acquireBranchLock('project-1');

      expect(hasBranchLock('project-1')).toBe(true);
      expect(typeof release).toBe('function');

      release();
      expect(hasBranchLock('project-1')).toBe(false);
    });

    it('allows locks for different projects simultaneously', async () => {
      const release1 = await acquireBranchLock('project-1');
      const release2 = await acquireBranchLock('project-2');

      expect(hasBranchLock('project-1')).toBe(true);
      expect(hasBranchLock('project-2')).toBe(true);

      release1();
      release2();
    });

    it('serializes lock acquisition for the same project', async () => {
      const executionOrder = [];

      // First lock holder
      const lock1Promise = acquireBranchLock('project-1').then((release) => {
        executionOrder.push('lock1-acquired');
        return new Promise((resolve) => {
          setTimeout(() => {
            executionOrder.push('lock1-releasing');
            release();
            resolve();
          }, 50);
        });
      });

      // Second lock request (should wait for first)
      const lock2Promise = acquireBranchLock('project-1').then((release) => {
        executionOrder.push('lock2-acquired');
        release();
      });

      await Promise.all([lock1Promise, lock2Promise]);

      expect(executionOrder).toEqual([
        'lock1-acquired',
        'lock1-releasing',
        'lock2-acquired',
      ]);
    });

    it('handles multiple waiters in order', async () => {
      const executionOrder = [];

      // Acquire first lock
      const release1 = await acquireBranchLock('project-1');
      executionOrder.push('lock1-acquired');

      // Queue up second and third locks
      const lock2Promise = acquireBranchLock('project-1').then((release) => {
        executionOrder.push('lock2-acquired');
        release();
        executionOrder.push('lock2-released');
      });

      const lock3Promise = acquireBranchLock('project-1').then((release) => {
        executionOrder.push('lock3-acquired');
        release();
        executionOrder.push('lock3-released');
      });

      // Release first lock after a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      release1();
      executionOrder.push('lock1-released');

      await Promise.all([lock2Promise, lock3Promise]);

      // Lock 1 releases, then 2 acquires and releases, then 3 acquires and releases
      expect(executionOrder[0]).toBe('lock1-acquired');
      expect(executionOrder[1]).toBe('lock1-released');
      // Lock 2 and 3 are acquired in order after lock 1 releases
      expect(executionOrder).toContain('lock2-acquired');
      expect(executionOrder).toContain('lock3-acquired');
    });
  });

  describe('hasBranchLock', () => {
    it('returns false when no lock exists', () => {
      expect(hasBranchLock('nonexistent-project')).toBe(false);
    });

    it('returns true when lock exists', async () => {
      const release = await acquireBranchLock('project-1');
      expect(hasBranchLock('project-1')).toBe(true);
      release();
    });

    it('returns false after lock is released', async () => {
      const release = await acquireBranchLock('project-1');
      expect(hasBranchLock('project-1')).toBe(true);
      release();
      expect(hasBranchLock('project-1')).toBe(false);
    });
  });

  describe('clearAllLocks', () => {
    it('clears all active locks', async () => {
      await acquireBranchLock('project-1');
      await acquireBranchLock('project-2');

      expect(hasBranchLock('project-1')).toBe(true);
      expect(hasBranchLock('project-2')).toBe(true);

      clearAllLocks();

      expect(hasBranchLock('project-1')).toBe(false);
      expect(hasBranchLock('project-2')).toBe(false);
    });
  });

  describe('race condition prevention', () => {
    it('prevents concurrent operations on the same project', async () => {
      const results = [];
      let counter = 0;

      // Simulate concurrent operations that would conflict without mutex
      const operation = async (id) => {
        const release = await acquireBranchLock('project-1');
        const startValue = counter;
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        counter = startValue + 1;
        results.push({ id, value: counter });
        release();
      };

      // Start multiple operations concurrently
      await Promise.all([operation('A'), operation('B'), operation('C')]);

      // Without mutex, these would all read counter=0 and set it to 1
      // With mutex, they execute sequentially: 0->1, 1->2, 2->3
      expect(counter).toBe(3);
      expect(results.map((r) => r.value).sort()).toEqual([1, 2, 3]);
    });
  });
});
