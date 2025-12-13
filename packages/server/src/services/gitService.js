import { exec } from 'child_process';
import { promisify } from 'util';

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
 * Check if a directory is a git repository
 * @param {string} directory
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(directory) {
  try {
    await git(directory, 'rev-parse --git-dir');
    return true;
  } catch {
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
 * Get list of branches
 * @param {string} directory
 * @returns {Promise<Array<{name: string, ref: string}>>}
 */
export async function getBranches(directory) {
  const output = await git(directory, 'branch -a --format="%(refname:short)|%(refname)"');
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [name, ref] = line.split('|');
      return { name, ref };
    });
}

/**
 * Get current branch name
 * @param {string} directory
 * @returns {Promise<string|null>}
 */
export async function getCurrentBranch(directory) {
  try {
    return await git(directory, 'branch --show-current');
  } catch {
    return null;
  }
}

/**
 * Create a new worktree
 * @param {string} directory
 * @param {string} branch
 * @param {string} path
 * @returns {Promise<{path: string, branch: string}>}
 */
export async function createWorktree(directory, branch, path) {
  await git(directory, `worktree add "${path}" -b "${branch}"`);
  return { path, branch };
}

/**
 * Remove a worktree
 * @param {string} directory
 * @param {string} path
 */
export async function removeWorktree(directory, path) {
  await git(directory, `worktree remove "${path}"`);
}

/**
 * Get diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getDiff(directory) {
  try {
    return await git(directory, 'diff');
  } catch {
    return '';
  }
}

/**
 * Get staged diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getStagedDiff(directory) {
  try {
    return await git(directory, 'diff --cached');
  } catch {
    return '';
  }
}
