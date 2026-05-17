import { exec } from 'child_process';
import { promisify } from 'util';
export {
  _setManagedHooksPath,
  clearWorktreeCommitAttribution,
  configureWorktreeCommitAttribution,
  ensureWorktreeCommitAttributionHook,
  getManagedHooksPath,
} from './gitCommitAttribution.js';
export {
  normalizeGitRemoteUrl,
  getRepositoryUrl,
  detectWorktreePath,
} from './gitRepoUrl.js';
export {
  getDiff,
  getStagedDiff,
  getUntrackedFiles,
  getDiffAgainstBranch,
  getStagedDiffAgainstBranch,
  getDiffBetweenRefs,
  getModifiedFilesCount,
} from './gitDiff.js';
export {
  branchExists,
  checkoutBranch,
  createWorktree,
  removeWorktree,
  createWorktreeForBranch,
} from './gitWorktree.js';

const execAsync = promisify(exec);

// Cache for default branch detection: directory -> { branch, timestamp }
const defaultBranchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of repositories to cache

import { _setWorktreeLogger } from './gitWorktree.js';

/**
 * Set a custom logger for git service warnings.
 * Useful for integrating with application logging or suppressing warnings in tests.
 * @param {Object} customLogger - Logger object with a warn method
 * @param {Function} customLogger.warn - Function to handle warning messages
 */
export function setLogger(customLogger) {
  _setWorktreeLogger(customLogger);
}

/** Evict oldest cache entries if size exceeds MAX_CACHE_SIZE (LRU-like). */
function evictOldestCacheEntries() {
  if (defaultBranchCache.size <= MAX_CACHE_SIZE) {
    return;
  }

  const entries = [...defaultBranchCache.entries()];
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

  const entriesToRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  for (const [key] of entriesToRemove) {
    defaultBranchCache.delete(key);
  }
}

/**
 * Execute a git command in a directory
 * @param {string} directory
 * @param {string} command
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {number} [opts.timeout]
 * @returns {Promise<string>}
 */
export async function git(directory, command, opts = {}) {
  const execOpts = { cwd: directory };
  if (opts.env) execOpts.env = opts.env;
  if (opts.timeout) execOpts.timeout = opts.timeout;
  const { stdout } = await execAsync(`git ${command}`, execOpts);
  return stdout.trim();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Detect the default branch using git commands (symbolic-ref, rev-parse).
 * @param {string} directory
 * @returns {Promise<string>}
 */
async function detectDefaultBranchFromGit(directory) {
  // Try to get the default branch from the remote HEAD
  try {
    const ref = await git(directory, 'symbolic-ref refs/remotes/origin/HEAD');
    // Returns something like "refs/remotes/origin/main"
    return ref.replace('refs/remotes/', '');
  } catch {
    // Fallback: check if origin/main exists, otherwise try origin/master
  }

  try {
    await git(directory, 'rev-parse --verify origin/main');
    return 'origin/main';
  } catch {
    // origin/main doesn't exist
  }

  try {
    await git(directory, 'rev-parse --verify origin/master');
    return 'origin/master';
  } catch {
    // No origin remote available, fall back to HEAD
    return 'HEAD';
  }
}

/**
 * Get the default branch from origin remote
 * Uses GitHub CLI if available, falls back to git commands
 * Results are cached per repository with a 5-minute TTL
 * Falls back to HEAD if no origin remote is configured
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getOriginDefaultBranch(directory) {
  // Check cache first
  const cached = defaultBranchCache.get(directory);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.branch;
  }

  let branch;

  // Try GitHub CLI first - most accurate method
  try {
    const { stdout } = await execAsync(
      'gh repo view --json defaultBranchRef --jq ".defaultBranchRef.name"',
      { cwd: directory }
    );
    const branchName = stdout.trim();
    if (branchName) {
      branch = `origin/${branchName}`;
    }
  } catch {
    // gh CLI not available or failed, fall back to git commands
  }

  if (!branch) {
    branch = await detectDefaultBranchFromGit(directory);
  }

  // Cache the result and evict old entries if needed
  defaultBranchCache.set(directory, { branch, timestamp: Date.now() });
  evictOldestCacheEntries();
  return branch;
}

/**
 * Clear the default branch cache for all repositories.
 * Useful for testing or when repository remote configuration has changed.
 */
export function clearDefaultBranchCache() {
  defaultBranchCache.clear();
}

/**
 * Get the current cache size (for testing purposes).
 * @returns {number} The number of entries in the cache
 */
export function getCacheSize() {
  return defaultBranchCache.size;
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
    // Use rev-parse which works in older git versions (--show-current was added in 2.22)
    const branch = await git(directory, 'rev-parse --abbrev-ref HEAD');
    // Returns 'HEAD' when in detached HEAD state
    return branch === 'HEAD' ? null : branch;
  } catch {
    return null;
  }
}

/**
 * Get the git author info from the global config (~/.gitconfig).
 * Uses `--global` so that a contaminated local config is bypassed.
 * @param {string} directory
 * @param {Object} [options]
 * @param {Object} [options.env] - Custom environment variables (useful for tests)
 * @returns {Promise<{name: string, email: string} | null>}
 */
export async function getGitAuthor(directory, { env } = {}) {
  try {
    const name = await git(directory, 'config --global user.name', { env });
    const email = await git(directory, 'config --global user.email', { env });
    if (name && email) {
      return { name, email };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pin the human developer's git identity in a worktree's config.
 * Reads user.name/user.email from the main project directory and writes them
 * into the worktree-specific config (--worktree). Only call for worktree dirs.
 * @param {string} worktreePath - The worktree directory
 * @param {string} projectDir - The main project directory (to read author from)
 * @param {Object} [options]
 * @param {Object} [options.env] - Custom environment variables (useful for tests)
 * @returns {Promise<boolean>} - True if author was pinned
 */
export async function pinAuthorInWorktree(worktreePath, projectDir, { env } = {}) {
  const author = await getGitAuthor(projectDir || worktreePath, { env });
  if (!author) return false;

  // Enable worktree-specific config (required for --worktree flag)
  await git(worktreePath, 'config extensions.worktreeConfig true');

  // Pin the human's identity in the worktree config so they are always
  // the commit Author, regardless of what the session does later
  await git(worktreePath, `config --worktree user.name ${shellQuote(author.name)}`);
  await git(worktreePath, `config --worktree user.email ${shellQuote(author.email)}`);

  return true;
}

