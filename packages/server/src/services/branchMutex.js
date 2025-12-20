/**
 * Mutex for serializing branch-mode git operations per project.
 *
 * When using gitMode='branch', operations must be serialized to prevent
 * race conditions where one session checks out a branch while another
 * session is about to start executing.
 */

/** @type {Map<string, Promise<void>>} Maps projectId to pending lock promise */
const locks = new Map();

/**
 * Acquire a lock for branch operations on a project.
 * If another operation is in progress, waits for it to complete.
 *
 * @param {string} projectId - The project ID to lock
 * @returns {Promise<() => void>} A release function to call when done
 */
export async function acquireBranchLock(projectId) {
  // Wait for any existing lock to be released
  while (locks.has(projectId)) {
    await locks.get(projectId);
  }

  // Create a new lock
  let releaseLock;
  const lockPromise = new Promise((resolve) => {
    releaseLock = resolve;
  });

  locks.set(projectId, lockPromise);

  // Return release function
  return () => {
    locks.delete(projectId);
    releaseLock();
  };
}

/**
 * Check if a project has an active branch lock
 * @param {string} projectId - The project ID to check
 * @returns {boolean} True if the project has an active lock
 */
export function hasBranchLock(projectId) {
  return locks.has(projectId);
}

/**
 * Clear all locks (for testing purposes)
 */
export function clearAllLocks() {
  locks.clear();
}
