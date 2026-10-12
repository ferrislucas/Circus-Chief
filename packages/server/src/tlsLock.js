import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Filesystem coordination for the shared self-signed persisted identity.
 *
 * Separate servers and worktrees share one TLS directory (by default
 * `~/.circuschief/tls`). Every read, generation, and publication of the final
 * `cert.pem`/`key.pem` pair happens while holding this per-directory lock, so
 * simultaneous first starts converge on a single identity and no caller ever
 * observes a half-published pair.
 *
 * Coordination layout (documented for operators and tests):
 * - `<tlsDir>/.lock/` holds the lock; creating it with mkdir is the atomic
 *   acquisition step.
 * - `<tlsDir>/.lock/owner.json` records `{ pid, token, createdAt }` so a lock
 *   left by a dead owner can be reclaimed, while a live owner's lock is never
 *   removed no matter how slow generation is.
 *
 * This module is a low-level primitive: it throws plain Errors and leaves
 * error policy (such as TLS-specific error types) to its caller.
 */
export const TLS_LOCK_DIRNAME = '.lock';
const TLS_LOCK_OWNER_FILENAME = 'owner.json';
const TLS_LOCK_TIMEOUT_MS = 60000;
const TLS_LOCK_POLL_MS = 25;
// A lock directory with no readable owner record is reclaimed only once it is
// this old: the mkdir-then-write window is milliseconds, so anything older
// has no live owner that wrote its record.
const TLS_ORPHAN_LOCK_MS = 10000;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export function removeQuietly(targetPath) {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort; a later sweep or start recovers leftovers.
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH means no such process; EPERM means it exists but is not
    // signalable — still a live owner whose lock must be kept.
    return err?.code === 'EPERM';
  }
}

function readLockOwner(lockDir) {
  try {
    const owner = JSON.parse(readFileSync(join(lockDir, TLS_LOCK_OWNER_FILENAME), 'utf-8'));
    if (owner && Number.isInteger(owner.pid) && typeof owner.token === 'string') return owner;
    return null;
  } catch {
    return null;
  }
}

/** Remove a lock left by a dead owner. Returns true when the lock is gone. */
function tryReclaimLock(lockDir) {
  const owner = readLockOwner(lockDir);
  if (owner) {
    if (isProcessAlive(owner.pid)) return false;
  } else {
    let ageMs = 0;
    try {
      ageMs = Date.now() - statSync(lockDir).mtimeMs;
    } catch {
      return true;
    }
    if (ageMs < TLS_ORPHAN_LOCK_MS) return false;
  }
  removeQuietly(lockDir);
  return !existsSync(lockDir);
}

function lockTimeoutMessage(lockDir, absDir, timeoutMs) {
  return (
    `Timed out waiting for the TLS certificate lock in ${absDir} after ${timeoutMs}ms. ` +
    `Another process is likely generating the self-signed certificate; retry once it finishes, ` +
    `or remove ${lockDir} if no server is starting.`
  );
}

/**
 * Hold the directory lock until released. Bounded waiting: throws an
 * actionable Error naming the directory after `timeoutMs` instead of hanging
 * forever. Only the returned token's owner may release this lock.
 */
export async function acquireTlsLock(absDir, { timeoutMs = TLS_LOCK_TIMEOUT_MS } = {}) {
  const lockDir = join(absDir, TLS_LOCK_DIRNAME);
  const deadline = Date.now() + Math.max(timeoutMs ?? TLS_LOCK_TIMEOUT_MS, 0);
  for (;;) {
    try {
      mkdirSync(lockDir);
      const lock = { lockDir, token: randomUUID() };
      writeFileSync(
        join(lockDir, TLS_LOCK_OWNER_FILENAME),
        JSON.stringify({ pid: process.pid, token: lock.token, createdAt: Date.now() })
      );
      return lock;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    if (tryReclaimLock(lockDir)) continue;
    if (Date.now() >= deadline) throw new Error(lockTimeoutMessage(lockDir, absDir, timeoutMs));
    await sleep(TLS_LOCK_POLL_MS);
  }
}

/** Release only coordination owned by this caller; never touches others'. */
export function releaseTlsLock(lock) {
  if (!lock) return;
  try {
    const owner = readLockOwner(lock.lockDir);
    if (owner && owner.token === lock.token) removeQuietly(lock.lockDir);
  } catch {
    // A missing lock directory simply means it is already gone.
  }
}
