import { afterEach, describe, expect, it } from 'vitest';
import { clearWorktreeSyncLocks, runWithWorktreeSyncLock } from './gitSyncCoordinator.js';

afterEach(() => clearWorktreeSyncLocks());

describe('runWithWorktreeSyncLock', () => {
  it('serializes operations for the same canonical worktree and releases after failure', async () => {
    let releaseFirst;
    let signalFirstStarted;
    const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
    const first = runWithWorktreeSyncLock('/tmp/sync-worktree', async () => new Promise((resolve) => {
      releaseFirst = resolve;
      signalFirstStarted();
    }));
    await firstStarted;
    const second = runWithWorktreeSyncLock('/tmp/sync-worktree', async () => 'second');

    let secondComplete = false;
    second.then(() => { secondComplete = true; });
    await Promise.resolve();
    expect(secondComplete).toBe(false);

    releaseFirst('first');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');

    await expect(runWithWorktreeSyncLock('/tmp/sync-worktree', async () => {
      throw new Error('expected');
    })).rejects.toThrow('expected');
    await expect(runWithWorktreeSyncLock('/tmp/sync-worktree', async () => 'released')).resolves.toBe('released');
  });

  it('does not block operations for different worktrees', async () => {
    let releaseFirst;
    let signalFirstStarted;
    const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
    const first = runWithWorktreeSyncLock('/tmp/sync-worktree-a', async () => new Promise((resolve) => {
      releaseFirst = resolve;
      signalFirstStarted();
    }));
    await firstStarted;
    await expect(runWithWorktreeSyncLock('/tmp/sync-worktree-b', async () => 'parallel')).resolves.toBe('parallel');
    releaseFirst('first');
    await first;
  });
});
