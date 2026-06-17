import { git, getOriginDefaultBranch } from './gitService.js';

// Configurable logger for warning messages
let logger = {
  warn: (...args) => console.warn(...args),
};

/**
 * Get the timeout for best-effort fetch operations (ms).
 * Read at call time so tests can override GIT_FETCH_TIMEOUT_MS without mocking.
 */
function getFetchTimeoutMs() {
  return Number(process.env.GIT_FETCH_TIMEOUT_MS) || 10_000;
}

/**
 * Set a custom logger for git worktree warnings.
 * @param {Object} customLogger - Logger object with a warn method
 */
export function _setWorktreeLogger(customLogger) {
  logger = customLogger;
}

/**
 * Safely fetch from origin remote with a short bounded timeout.
 * Logs a warning if fetch fails or times out but does not throw.
 * Worktree creation always continues from local refs on failure.
 * @param {string} directory - The git repository directory
 * @returns {Promise<boolean>} - True if fetch succeeded, false otherwise
 */
async function safeFetchOrigin(directory) {
  try {
    await git(directory, 'fetch origin', { timeout: getFetchTimeoutMs() });
    return true;
  } catch (err) {
    // No origin, network unavailable, or timed out — proceed with local refs
    logger.warn('Could not fetch from origin, proceeding with local refs:', err.message);
    return false;
  }
}

/**
 * Check if a branch exists
 * @param {string} directory
 * @param {string} branch
 * @returns {Promise<boolean>}
 */
export async function branchExists(directory, branch) {
  try {
    await git(directory, `rev-parse --verify refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checkout a branch, creating it if it doesn't exist
 * @param {string} directory
 * @param {string} branch
 * @returns {Promise<void>}
 */
export async function checkoutBranch(directory, branch) {
  const exists = await branchExists(directory, branch);
  if (exists) {
    await git(directory, `checkout "${branch}"`);
  } else {
    await git(directory, `checkout -b "${branch}"`);
  }
}

/**
 * Create a new worktree
 * @param {string} directory
 * @param {string} branch
 * @param {string} worktreePath
 * @param {Object} options
 * @param {boolean} options.skipFetch - Skip fetching from origin (default: false)
 * @returns {Promise<{path: string, branch: string}>}
 */
export async function createWorktree(directory, branch, worktreePath, options = {}) {
  const { skipFetch = false } = options;

  // Fetch latest from origin to ensure we have up-to-date default branch
  if (!skipFetch) {
    await safeFetchOrigin(directory);
  }

  // Get the default branch from origin (main or master)
  const defaultBranch = await getOriginDefaultBranch(directory);
  // Base new branch on origin's default branch to avoid including unrelated commits from HEAD
  // Use --no-track to prevent the new branch from tracking the start-point (main/master)
  await git(directory, `worktree add --no-track "${worktreePath}" -b "${branch}" ${defaultBranch}`);
  return { path: worktreePath, branch };
}

/**
 * Remove a worktree
 * @param {string} directory
 * @param {string} path
 * @param {boolean} force - Force removal even if worktree has uncommitted changes
 */
export async function removeWorktree(directory, worktreePath, force = false) {
  const forceFlag = force ? '--force' : '';
  await git(directory, `worktree remove ${forceFlag} "${worktreePath}"`);
}

/**
 * Create a worktree for a branch (creates branch if it doesn't exist)
 * @param {string} directory - Main repo directory
 * @param {string} branch - Branch name
 * @param {string} worktreePath - Path for the new worktree
 * @param {Object} options
 * @param {boolean} options.skipFetch - Skip fetching from origin (default: false)
 * @returns {Promise<{path: string, branch: string}>}
 */
export async function createWorktreeForBranch(directory, branch, worktreePath, options = {}) {
  const { skipFetch = false } = options;

  // Fetch latest from origin to ensure we have up-to-date default branch
  if (!skipFetch) {
    await safeFetchOrigin(directory);
  }

  const exists = await branchExists(directory, branch);
  if (exists) {
    await git(directory, `worktree add "${worktreePath}" "${branch}"`);
  } else {
    // Get the default branch from origin (main or master)
    const defaultBranch = await getOriginDefaultBranch(directory);
    // Base new branch on origin's default branch to avoid including unrelated commits from HEAD
    // Use --no-track to prevent the new branch from tracking the start-point (main/master)
    await git(directory, `worktree add --no-track -b "${branch}" "${worktreePath}" ${defaultBranch}`);
  }
  return { path: worktreePath, branch };
}
