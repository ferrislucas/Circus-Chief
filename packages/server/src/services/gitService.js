import { exec } from 'child_process';
import { promisify } from 'util';

// Re-export all functions from extracted modules so existing consumers are unaffected
export {
  isGitRepo,
  getDiff,
  getStagedDiff,
  getUntrackedFiles,
  getDiffAgainstBranch,
  getStagedDiffAgainstBranch,
  getDiffBetweenRefs,
  getModifiedFilesCount,
} from './gitRepoInfo.js';
export { getCurrentBranch, getBranches, branchExists, checkoutBranch } from './gitBranchOps.js';
export { getWorktrees, createWorktree, removeWorktree, createWorktreeForBranch } from './worktreeManager.js';

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
 * Get the current logger instance.
 * Used by extracted modules (e.g., worktreeManager) to access the shared logger.
 * @returns {Object} The current logger object
 */
export function getLogger() {
  return logger;
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
