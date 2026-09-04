import { realpath } from 'fs/promises';
import { resolve } from 'path';

// Process-local serialization for destructive Git sync operations. Deployments
// with more than one server process need a shared lock at their orchestration
// boundary; this prevents overlap between sessions served by this process.
const worktreeQueues = new Map();

export async function canonicalWorktreePath(directory) {
  try {
    return await realpath(directory);
  } catch {
    return resolve(directory);
  }
}

export async function runWithWorktreeSyncLock(directory, operation) {
  const key = await canonicalWorktreePath(directory);
  const previous = worktreeQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolveCurrent) => { release = resolveCurrent; });
  const queueEntry = previous.catch(() => undefined).then(() => current);
  worktreeQueues.set(key, queueEntry);

  await previous.catch(() => undefined);
  try {
    return await operation(key);
  } finally {
    release();
    if (worktreeQueues.get(key) === queueEntry) worktreeQueues.delete(key);
  }
}

export function clearWorktreeSyncLocks() {
  worktreeQueues.clear();
}
