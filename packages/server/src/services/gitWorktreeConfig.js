import { execFile } from 'child_process';
import { promisify } from 'util';
import { realpath } from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);
const inFlight = new Map();
const ATTEMPTS = 4;

async function runGit(directory, command) {
  const { stdout } = await execFileAsync('git', command.split(' '), { cwd: directory });
  return stdout.trim();
}

export class SharedGitConfigContentionError extends Error {
  constructor(commonDir, cause) {
    super(`Repository shared Git config contention in ${commonDir}: could not acquire config lock`, { cause });
    this.code = 'GIT_SHARED_CONFIG_CONTENTION';
  }
}

export async function ensureWorktreeConfigEnabled(worktreePath, { git = runGit, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = ATTEMPTS } = {}) {
  const common = path.resolve(worktreePath, await git(worktreePath, 'rev-parse --git-common-dir'));
  // The lock key is the canonical common Git directory, not the worktree
  // path: every linked worktree of one repository shares .git/config, so
  // concurrent starts from different worktrees must serialize here — while
  // different repositories keep independent keys and stay parallel. Retries
  // are safe only because enabling extensions.worktreeConfig is idempotent;
  // the per-worktree author/hook writes that follow are never retried here.
  const key = await realpath(common);
  const previous = inFlight.get(key);
  if (previous) return previous;
  // eslint-disable-next-line sonarjs/cognitive-complexity -- bounded retry keeps read and write paired
  const task = (async () => {
    // Hard floor of one attempt so a misconfigured budget can never fall
    // through the loop and report success without having run.
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
      let enabled;
      try {
        enabled = await git(worktreePath, 'config --bool --get extensions.worktreeConfig');
      } catch (error) {
        if (error.code !== 1) throw error;
      }
      if (enabled === 'true') return;
      try {
        await git(worktreePath, 'config extensions.worktreeConfig true');
        return;
      } catch (error) {
        const message = `${error.stderr || ''} ${error.message || ''}`;
        if (!/could not lock config file .*config: File exists/i.test(message)) throw error;
        if (attempt === Math.max(1, attempts) - 1) throw new SharedGitConfigContentionError(key, error);
        await sleep(Math.min(50 * 2 ** attempt, 200));
      }
    }
  })();
  inFlight.set(key, task);
  try { await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
}
