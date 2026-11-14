import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureWorktreeConfigEnabled } from './gitWorktreeConfig.js';

describe('worktree config initialization', () => {
  it('coalesces callers for a common repository and skips subsequent writes', async () => {
    let enabled = false;
    const git = vi.fn(async (_dir, command) => {
      if (command === 'rev-parse --git-common-dir') return '/tmp';
      if (command === 'config --bool --get extensions.worktreeConfig') return enabled ? 'true' : 'false';
      if (command === 'config extensions.worktreeConfig true') enabled = true;
    });
    await Promise.all(['/one', '/two'].map((dir) => ensureWorktreeConfigEnabled(dir, { git })));
    await ensureWorktreeConfigEnabled('/one', { git });
    expect(git.mock.calls.filter(([, cmd]) => cmd === 'config extensions.worktreeConfig true')).toHaveLength(1);
  });

  it('rechecks after a collision and classifies persistent contention', async () => {
    let enabled = false;
    const git = vi.fn(async (_dir, command) => {
      if (command.startsWith('rev-parse')) return '/tmp';
      if (command.includes('--get')) return enabled ? 'true' : 'false';
      throw new Error('could not lock config file /tmp/config: File exists');
    });
    const sleep = vi.fn(async () => { enabled = true; });
    await ensureWorktreeConfigEnabled('/one', { git, sleep });
    expect(sleep).toHaveBeenCalledOnce();
    enabled = false;
    await expect(ensureWorktreeConfigEnabled('/one', { git, sleep: async () => {}, attempts: 2 }))
      .rejects.toMatchObject({ code: 'GIT_SHARED_CONFIG_CONTENTION' });
  });

  it('lets different repositories initialize concurrently', async () => {
    // Repository A's enable write stalls on a deferred promise; repository B
    // must still complete its whole initialization while A is in flight,
    // proving the in-memory lock does not serialize unrelated repositories.
    // realpath needs real directories, so common dirs are temp directories.
    const repoA = await mkdtemp(join(tmpdir(), 'wt-config-a-'));
    const repoB = await mkdtemp(join(tmpdir(), 'wt-config-b-'));
    let releaseA;
    const gateA = new Promise((resolve) => { releaseA = resolve; });
    let aEntered = false;
    const gitFor = (commonDir) => vi.fn(async (_dir, command) => {
      if (command.startsWith('rev-parse')) return commonDir;
      if (command.includes('--get')) return 'false';
      if (commonDir === repoA) {
        aEntered = true;
        await gateA;
      }
    });
    const a = ensureWorktreeConfigEnabled(repoA, { git: gitFor(repoA) });
    await vi.waitFor(() => { expect(aEntered).toBe(true); });
    await expect(ensureWorktreeConfigEnabled(repoB, { git: gitFor(repoB) })).resolves.toBeUndefined();
    releaseA();
    await expect(a).resolves.toBeUndefined();
  });
});
