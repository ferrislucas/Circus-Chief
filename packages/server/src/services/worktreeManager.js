import { exec } from 'child_process';
import { promisify } from 'util';
import { branchExists } from './gitBranchOps.js';
import { getOriginDefaultBranch, getLogger } from './gitService.js';

const execAsync = promisify(exec);

/**
 * Execute a git command in a directory
 * @param {string} directory
 * @param {string} command
 * @returns {Promise<string>}
 */
async function git(directory, command) {
  const { stdout } = await execAsync(`git ${command}`, { cwd: directory });
  return stdout.trim();
}

/**
 * Safely fetch from origin remote.
 * Logs a warning if fetch fails but does not throw.
 * @param {string} directory - The git repository directory
 * @returns {Promise<boolean>} - True if fetch succeeded, false otherwise
 */
async function safeFetchOrigin(directory) {
  try {
    await git(directory, 'fetch origin');
    return true;
  } catch (err) {
    // No origin or network unavailable, proceed without fetch
    const logger = getLogger();
    logger.warn('Could not fetch from origin, proceeding with local refs:', err.message);
    return false;
  }
}

/**
 * Get list of worktrees
 * @param {string} directory
 * @returns {Promise<Array<{path: string, branch: string, commit: string}>>}
 */
export async function getWorktrees(directory) {
  const output = await git(directory, 'worktree list --porcelain');
  const worktrees = [];
  let current = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9) };
    } else if (line.startsWith('HEAD ')) {
      current.commit = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'detached') {
      current.branch = null;
    }
  }

  if (current.path) worktrees.push(current);
  return worktrees;
}

/**
 * Create a new worktree
 * @param {string} directory
 * @param {string} branch
 * @param {string} path
 * @param {Object} options
 * @param {boolean} options.skipFetch - Skip fetching from origin (default: false)
 * @returns {Promise<{path: string, branch: string}>}
 */
export async function createWorktree(directory, branch, path, options = {}) {
  const { skipFetch = false } = options;

  // Fetch latest from origin to ensure we have up-to-date default branch
  if (!skipFetch) {
    await safeFetchOrigin(directory);
  }

  // Get the default branch from origin (main or master)
  const defaultBranch = await getOriginDefaultBranch(directory);
  // Base new branch on origin's default branch to avoid including unrelated commits from HEAD
  // Use --no-track to prevent the new branch from tracking the start-point (main/master)
  await git(directory, `worktree add --no-track "${path}" -b "${branch}" ${defaultBranch}`);
  return { path, branch };
}

/**
 * Remove a worktree
 * @param {string} directory
 * @param {string} path
 * @param {boolean} force - Force removal even if worktree has uncommitted changes
 */
export async function removeWorktree(directory, path, force = false) {
  const forceFlag = force ? '--force' : '';
  await git(directory, `worktree remove ${forceFlag} "${path}"`);
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
