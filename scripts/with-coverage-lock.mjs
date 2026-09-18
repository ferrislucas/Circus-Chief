#!/usr/bin/env node
/**
 * Serializes coverage runs for a given package so only one is in flight at a
 * time on this machine.
 *
 * The lock lives in the OS temp dir rather than inside the repo on purpose.
 * Coverage runs are CPU/disk heavy, and this project is routinely checked out
 * many times at once via git worktrees. A repo-local lock is scoped to a single
 * worktree, so N worktrees would happily run N simultaneous coverage suites --
 * exactly the contention this script exists to prevent. Under that load,
 * supertest-based API tests start failing with transport errors (ECONNRESET /
 * socket hang up) that have nothing to do with the code under test.
 *
 * Keying the lock by package name in a machine-wide directory means
 * `@circuschief/server` coverage is serialized across every worktree, while
 * different packages (server vs web) may still overlap.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const [, , ...command] = process.argv;

if (command.length === 0) {
  console.error('Usage: node scripts/with-coverage-lock.mjs <command> [args...]');
  process.exit(2);
}

// Overridable so CI (or a developer debugging lock behaviour) can point the
// locks somewhere else without editing this script.
function coverageLockRoot() {
  return process.env.COVERAGE_LOCK_DIR || join(tmpdir(), 'circuschief-coverage-locks');
}

async function getPackageName(cwd) {
  const packagePath = join(cwd, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  return pkg.name || cwd.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLock(lockDir) {
  try {
    return JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// A freshly created lock directory is briefly empty while the winner writes
// owner.json. Waiters must tolerate that gap; if they instead treat "no owner
// file" as "stale lock" they will delete a live lock and both processes run.
const OWNER_WRITE_GRACE_MS = 10000;

async function acquireLock(lockDir) {
  await mkdir(dirname(lockDir), { recursive: true });
  let ownerMissingSince = null;

  while (true) {
    try {
      // mkdir with recursive:false is the atomic compare-and-swap: exactly one
      // process can create the directory, and that process owns the lock.
      await mkdir(lockDir, { recursive: false });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const owner = await readLock(lockDir);

      if (owner && !isProcessAlive(owner.pid)) {
        // Holder died without releasing (killed, crashed, machine reboot).
        await rm(lockDir, { recursive: true, force: true });
        ownerMissingSince = null;
        continue;
      }

      if (!owner) {
        // Either the owner is mid-write, or a previous holder was killed
        // between mkdir and writeFile and left an orphaned empty directory.
        // Distinguish them by waiting: a live owner publishes within
        // milliseconds, an orphan never will.
        ownerMissingSince ??= Date.now();
        if (Date.now() - ownerMissingSince >= OWNER_WRITE_GRACE_MS) {
          console.error('[coverage-lock] Reclaiming lock with no owner metadata');
          await rm(lockDir, { recursive: true, force: true });
          ownerMissingSince = null;
          continue;
        }
        await sleep(100);
        continue;
      }

      ownerMissingSince = null;
      console.error(
        `[coverage-lock] Waiting for coverage run owned by pid ${owner.pid}` +
          (owner.cwd ? ` (${owner.cwd})` : '')
      );
      await sleep(5000);
      continue;
    }

    // The directory is ours, so publish ownership metadata for waiters.
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid,
      // The holder is often a different worktree now that the lock is
      // machine-wide, so record where it is running to keep waits debuggable.
      cwd: process.cwd(),
      command,
      startedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }
}

const packageName = await getPackageName(process.cwd());
const lockName = packageName.replace(/[^a-zA-Z0-9_.-]/g, '_');
const lockDir = join(coverageLockRoot(), lockName);
let released = false;

async function releaseLock() {
  if (released) return;
  released = true;
  await rm(lockDir, { recursive: true, force: true });
}

await acquireLock(lockDir);

const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', async (code, signal) => {
  await releaseLock();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
