import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, chmod } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

// Cache for default branch detection per repository
// Key: directory path, Value: { branch: string, timestamp: number }
const defaultBranchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of repositories to cache

// Configurable logger for warning messages
// Can be overridden via setLogger() for custom logging behavior
let logger = {
  warn: (...args) => console.warn(...args),
};

/**
 * Set a custom logger for git service warnings.
 * Useful for integrating with application logging or suppressing warnings in tests.
 * @param {Object} customLogger - Logger object with a warn method
 * @param {Function} customLogger.warn - Function to handle warning messages
 */
export function setLogger(customLogger) {
  logger = customLogger;
}

/**
 * Evict oldest entries from cache if it exceeds MAX_CACHE_SIZE.
 * Uses LRU-like eviction based on timestamp.
 */
function evictOldestCacheEntries() {
  if (defaultBranchCache.size <= MAX_CACHE_SIZE) {
    return;
  }

  // Sort entries by timestamp and remove oldest ones
  const entries = [...defaultBranchCache.entries()];
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

  const entriesToRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  for (const [key] of entriesToRemove) {
    defaultBranchCache.delete(key);
  }
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
    logger.warn('Could not fetch from origin, proceeding with local refs:', err.message);
    return false;
  }
}

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
    // Try to get the default branch from the remote HEAD
    try {
      const ref = await git(directory, 'symbolic-ref refs/remotes/origin/HEAD');
      // Returns something like "refs/remotes/origin/main"
      branch = ref.replace('refs/remotes/', '');
    } catch {
      // Fallback: check if origin/main exists, otherwise try origin/master
      try {
        await git(directory, 'rev-parse --verify origin/main');
        branch = 'origin/main';
      } catch {
        try {
          await git(directory, 'rev-parse --verify origin/master');
          branch = 'origin/master';
        } catch {
          // No origin remote available, fall back to HEAD
          branch = 'HEAD';
        }
      }
    }
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

/**
 * Get list of untracked files
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function getUntrackedFiles(directory) {
  try {
    const output = await git(directory, 'ls-files --others --exclude-standard');
    if (!output) return [];
    return output.split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
}

/**
 * Get diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getDiffAgainstBranch(directory, branch) {
  try {
    return await git(directory, `diff ${branch}`);
  } catch {
    return '';
  }
}

/**
 * Get staged diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getStagedDiffAgainstBranch(directory, branch) {
  try {
    return await git(directory, `diff --cached ${branch}`);
  } catch {
    return '';
  }
}

/**
 * Get diff between two git refs (e.g., comparing HEAD to origin/main)
 * This shows the committed changes between two refs, ignoring working tree state
 * @param {string} directory
 * @param {string} fromRef - Base ref (e.g., 'origin/main')
 * @param {string} toRef - Target ref (e.g., 'HEAD')
 * @returns {Promise<string>}
 */
export async function getDiffBetweenRefs(directory, fromRef, toRef) {
  try {
    return await git(directory, `diff ${fromRef} ${toRef}`);
  } catch {
    return '';
  }
}

/**
 * Get count of files modified/added compared to a branch
 * Includes committed changes + staged + unstaged + untracked files
 * @param {string} directory - The git repository directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<number>} - Total count of unique files modified/added
 */
export async function getModifiedFilesCount(directory, branch) {
  try {
    // Get all modified files in one command using --name-only
    // This includes: committed changes vs branch + staged
    const committedAndStaged = await git(
      directory,
      `diff --name-only ${branch}...HEAD`
    );

    // Get unstaged changes (working tree vs index)
    const unstaged = await git(directory, 'diff --name-only');

    // Get untracked files
    const untracked = await getUntrackedFiles(directory);

    // Combine all files into a Set to get unique count
    const allFiles = new Set();

    // Parse committed+staged files
    if (committedAndStaged) {
      committedAndStaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    // Parse unstaged files
    if (unstaged) {
      unstaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    // Add untracked files
    untracked.forEach(f => allFiles.add(f));

    return allFiles.size;
  } catch (error) {
    logger.warn(`Failed to get modified files count for ${directory}:`, error.message);
    return 0;
  }
}

/**
 * Get the git author info configured for a directory
 * @param {string} directory
 * @returns {Promise<{name: string, email: string} | null>}
 */
export async function getGitAuthor(directory) {
  try {
    const name = await git(directory, 'config user.name');
    const email = await git(directory, 'config user.email');
    if (name && email) {
      return { name, email };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Install a commit-msg hook that adds the human developer as co-author.
 * Creates a hooks/ directory inside the worktree's git internal dir
 * (e.g. .git/worktrees/<id>/hooks/commit-msg), then sets core.hooksPath
 * (worktree-specific) to point to it. This avoids polluting the working tree.
 *
 * Reads the author from the main project directory (not the worktree) to
 * capture the human developer's identity before the session may override it.
 *
 * Only call this for worktree directories, not the main repo.
 *
 * @param {string} worktreePath - The worktree directory
 * @param {string} projectDir - The main project directory (to read author from)
 * @returns {Promise<boolean>} - True if hook was installed
 */
export async function installCoAuthorHook(worktreePath, projectDir) {
  const author = await getGitAuthor(projectDir || worktreePath);
  if (!author) return false;

  // Use the git internal dir for this worktree (e.g. .git/worktrees/<id>)
  // so we don't pollute the working directory with hook files
  const gitDir = await git(worktreePath, 'rev-parse --git-dir');
  const hooksDir = join(gitDir, 'hooks');
  const hookPath = join(hooksDir, 'commit-msg');

  const coAuthorLine = `Co-Authored-By: ${author.name} <${author.email}>`;

  // The hook script:
  // 1. Reads the commit message file ($1)
  // 2. Checks if the co-author line is already present
  // 3. If not, appends it
  const hookScript = `#!/bin/sh
# claudetools: Auto-add human co-author to commits
COMMIT_MSG_FILE="$1"
CO_AUTHOR_LINE="${coAuthorLine}"

# Only add if not already present
if ! grep -qF "$CO_AUTHOR_LINE" "$COMMIT_MSG_FILE"; then
  echo "" >> "$COMMIT_MSG_FILE"
  echo "$CO_AUTHOR_LINE" >> "$COMMIT_MSG_FILE"
fi
`;

  await mkdir(hooksDir, { recursive: true });
  await writeFile(hookPath, hookScript, 'utf-8');
  await chmod(hookPath, 0o755);

  // Enable worktree-specific config (required for --worktree flag)
  await git(worktreePath, 'config extensions.worktreeConfig true');
  // Set hooksPath only for this worktree (doesn't affect main repo or other worktrees)
  await git(worktreePath, `config --worktree core.hooksPath ${hooksDir}`);

  return true;
}
