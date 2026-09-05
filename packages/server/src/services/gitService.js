/* eslint-disable max-lines */
import { exec } from 'child_process';
import { promisify } from 'util';
import { classifyGitError } from './gitErrorClassify.js';
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
export const DEFAULT_GIT_MAX_BUFFER = 100 * 1024 * 1024;

/** Default timeout for git subprocesses (ms). Override with GIT_TIMEOUT_MS env var. */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;

/**
 * Non-interactive git environment defaults.
 *
 * GIT_TERMINAL_PROMPT=0  — prevents HTTP(S) credential prompts from blocking.
 * GIT_ASKPASS=true       — points git's credential helper at /bin/true (no output),
 *                          so git surfaces auth failures quickly rather than hanging.
 * GIT_SSH_COMMAND        — disables SSH host-key/auth prompts and bounds TCP connect.
 */
export const DEFAULT_GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'true',
  GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10',
};

export { classifyGitError } from './gitErrorClassify.js';

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
 * @param {number} [opts.maxBuffer]
 * @returns {Promise<string>}
 */
export async function git(directory, command, opts = {}) {
  const timeoutMs = opts.timeout ?? (Number(process.env.GIT_TIMEOUT_MS) || DEFAULT_GIT_TIMEOUT_MS);
  const execOpts = {
    cwd: directory,
    maxBuffer: opts.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
    timeout: timeoutMs,
    env: { ...process.env, ...DEFAULT_GIT_ENV, ...(opts.env || {}) },
  };
  try {
    const { stdout } = await execAsync(`git ${command}`, execOpts);
    return stdout.trim();
  } catch (err) {
    // Normalize timeout errors for clarity
    if (err.killed || (err.signal && err.code === null)) {
      const msg = `Git command timed out after ${timeoutMs}ms: git ${command}`;
      const timeoutErr = new Error(msg);
      timeoutErr.code = 'GIT_TIMEOUT';
      timeoutErr.originalError = err;
      throw timeoutErr;
    }
    throw err;
  }
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
    const ghTimeoutMs = Number(process.env.GH_REPO_VIEW_TIMEOUT_MS) || 10_000;
    const { stdout } = await execAsync(
      'gh repo view --json defaultBranchRef --jq ".defaultBranchRef.name"',
      { cwd: directory, timeout: ghTimeoutMs }
    );
    const branchName = stdout.trim();
    if (branchName) {
      branch = `origin/${branchName}`;
    }
  } catch {
    // gh CLI not available, timed out, or failed — fall back to git commands
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
 * Get the configured upstream branch for HEAD.
 * @param {string} directory
 * @returns {Promise<string|null>}
 */
export async function getBranchUpstream(directory) {
  try {
    return await git(directory, 'rev-parse --abbrev-ref --symbolic-full-name @{u}');
  } catch {
    return null;
  }
}

/** Return whether the repository has the only remote supported by session sync. */
export async function hasOriginRemote(directory) {
  try {
    await git(directory, 'remote get-url origin');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ahead/behind counts relative to an upstream branch.
 * @param {string} directory
 * @param {string} upstreamBranch
 * @returns {Promise<{aheadCount: number, behindCount: number}>}
 */
export async function getAheadBehindCounts(directory, upstreamBranch) {
  const output = await git(directory, `rev-list --left-right --count ${shellQuote(upstreamBranch)}...HEAD`);
  const [behindRaw = '0', aheadRaw = '0'] = output.split(/\s+/);
  return {
    behindCount: Number.parseInt(behindRaw, 10) || 0,
    aheadCount: Number.parseInt(aheadRaw, 10) || 0,
  };
}

function parsePorcelainPath(line) {
  const rawPath = line.slice(3).trim();
  if (!rawPath) return null;

  const renameSeparator = ' -> ';
  if (rawPath.includes(renameSeparator)) {
    return rawPath.split(renameSeparator).pop();
  }

  return rawPath;
}

/**
 * Count unique paths with uncommitted local changes.
 * @param {string} directory
 * @returns {Promise<number>}
 */
export async function getLocalChangeCount(directory) {
  const output = await git(directory, 'status --porcelain=v1');
  if (!output) return 0;

  const paths = new Set();
  for (const line of output.split('\n')) {
    const path = parsePorcelainPath(line);
    if (path) paths.add(path);
  }
  return paths.size;
}

/**
 * Fetch origin with pruning. Intended for explicit user refreshes, not polling.
 * @param {string} directory
 * @returns {Promise<void>}
 */
export async function fetchOrigin(directory) {
  await git(directory, 'fetch origin --prune', { timeout: 10_000 });
}

function computeSyncStatus({ currentBranch, upstreamBranch, aheadCount, behindCount, localChangeCount }) {
  if (!currentBranch) return 'unknown';
  if (!upstreamBranch) return 'unpublished';
  if (aheadCount > 0 && behindCount > 0) return 'diverged';
  if (behindCount > 0) return 'behind';
  if (aheadCount > 0) return 'ahead';
  if (localChangeCount > 0) return 'dirty';
  return 'clean';
}

/**
 * Get compact Git repository status for a session worktree.
 * @param {string} directory
 * @param {Object} [options]
 * @param {boolean} [options.fetch=false]
 * @returns {Promise<Object>}
 */
export async function getSessionGitStatus(directory, options = {}) {
  const fetched = options.fetch === true;
  const hasOrigin = await hasOriginRemote(directory);
  // Local facts are authoritative even when an optional remote refresh fails.
  // Collect them first so clients never lose branch or dirty-worktree context.
  const currentBranch = await getCurrentBranch(directory);
  const localChangeCount = await getLocalChangeCount(directory);
  const upstreamBranch = currentBranch ? await getBranchUpstream(directory) : null;
  let remoteError = null;
  if (fetched) {
    try {
      if (!hasOrigin) throw new GitSyncError('no_origin');
      await fetchOrigin(directory);
    } catch (error) {
      remoteError = normalizeSyncError(error, 'refresh');
    }
  }
  let counts = { aheadCount: 0, behindCount: 0 };
  if (upstreamBranch) {
    try {
      counts = await getAheadBehindCounts(directory, upstreamBranch);
    } catch (error) {
      // A successful pruning fetch can remove the configured upstream ref. Keep
      // the local facts collected above and report comparison as unavailable.
      remoteError ||= normalizeSyncError(error, 'refresh');
    }
  }
  const syncStatus = computeSyncStatus({
    currentBranch,
    upstreamBranch,
    aheadCount: counts.aheadCount,
    behindCount: counts.behindCount,
    localChangeCount,
  });

  return {
    hasOrigin,
    currentBranch,
    upstreamBranch,
    hasUpstream: Boolean(upstreamBranch),
    hasUncommittedChanges: localChangeCount > 0,
    localChangeCount,
    aheadCount: counts.aheadCount,
    behindCount: counts.behindCount,
    isDiverged: counts.aheadCount > 0 && counts.behindCount > 0,
    isUnpushed: counts.aheadCount > 0 || syncStatus === 'unpublished',
    isBehind: counts.behindCount > 0,
    syncStatus,
    lastCheckedAt: new Date().toISOString(),
    fetched: fetched && !remoteError,
    ...(remoteError ? {
      remoteError: { code: remoteError.code, message: remoteError.message },
      error: remoteError.message,
    } : {}),
  };
}

const SYNC_ERRORS = {
  detached_head: [400, 'This worktree is detached. Check out a branch to push or pull.'],
  invalid_branch: [400, 'This branch name is not safe to synchronize.'],
  no_origin: [400, 'No origin remote is configured for this worktree.'],
  no_upstream: [400, 'This branch has no origin upstream. Publish it before pulling.'],
  non_origin_upstream: [400, 'This branch does not track an origin branch.'],
  invalid_upstream: [400, 'This branch has an unsupported origin upstream.'],
  dirty_worktree: [409, 'Pull stopped because the worktree has uncommitted changes. Commit, stash, or discard them, then pull again.'],
  diverged: [409, 'Pull stopped: histories diverged. Resolve them in your normal Git workflow, then refresh.'],
  push_rejected: [409, 'Push rejected because origin has newer commits. Pull and reconcile before pushing again.'],
  pull_conflict: [409, 'Pull stopped by a conflict. Resolve it in the worktree, then refresh.'],
  remote_unreachable: [502, 'Could not reach origin. Check authentication and network, then try again.'],
  git_timeout: [504, 'Git operation timed out. Try again.'],
  git_error: [502, 'Git synchronization failed. Check the worktree and origin, then try again.'],
};

export class GitSyncError extends Error {
  constructor(code, cause) {
    const [status, message] = SYNC_ERRORS[code] || SYNC_ERRORS.git_error;
    super(message);
    this.name = 'GitSyncError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

// The operation-specific classification intentionally stays explicit so no raw Git
// output leaves this boundary.
// eslint-disable-next-line complexity
function normalizeSyncError(error, operation) {
  if (error instanceof GitSyncError) return error;
  const classified = classifyGitError(error);
  if (classified.code === 'git_timeout') return new GitSyncError('git_timeout', error);
  if (classified.code === 'git_remote_unreachable' || classified.code === 'git_credential_required' || classified.code === 'git_permission_denied') {
    return new GitSyncError('remote_unreachable', error);
  }
  const text = [error.message, error.stderr, error.stdout].filter(Boolean).join(' ').toLowerCase();
  if (operation === 'push' && (text.includes('non-fast-forward') || text.includes('fetch first') || text.includes('rejected'))) return new GitSyncError('push_rejected', error);
  if (operation === 'pull' && (text.includes('not possible to fast-forward') || text.includes('divergent') || text.includes('would be overwritten'))) return new GitSyncError(text.includes('overwritten') ? 'dirty_worktree' : 'diverged', error);
  if (operation === 'pull' && text.includes('conflict')) return new GitSyncError('pull_conflict', error);
  return new GitSyncError('git_error', error);
}

async function getSyncTarget(directory, operation) {
  const branch = await getCurrentBranch(directory);
  if (!branch) throw new GitSyncError('detached_head');
  if (!await isValidBranchName(directory, branch)) throw new GitSyncError('invalid_branch');
  if (!await hasOriginRemote(directory)) throw new GitSyncError('no_origin');
  const upstream = await getBranchUpstream(directory);
  const upstreamBranch = await getValidatedOriginUpstreamBranch(directory, upstream);
  if (operation === 'pull' && !upstream) throw new GitSyncError('no_upstream');
  return { branch, upstream, upstreamBranch };
}

async function isValidBranchName(directory, branch) {
  try {
    await git(directory, `check-ref-format --branch ${shellQuote(branch)}`);
    return true;
  } catch {
    return false;
  }
}

async function getValidatedOriginUpstreamBranch(directory, upstream) {
  if (!upstream) return null;
  if (!upstream.startsWith('origin/')) throw new GitSyncError('non_origin_upstream');

  const branch = upstream.slice('origin/'.length);
  if (!branch || !await isValidBranchName(directory, branch)) {
    throw new GitSyncError('invalid_upstream');
  }
  return branch;
}

async function statusAfterSync(directory) {
  try { return await getSessionGitStatus(directory); } catch { return null; }
}

export async function pushSessionBranch(directory) {
  let target;
  try {
    target = await getSyncTarget(directory, 'push');
    // Always state both sides of the refspec. An existing upstream can map a
    // local branch to a differently named origin branch, which a bare branch
    // argument would silently ignore.
    const remoteBranch = target.upstreamBranch || target.branch;
    const refspec = `refs/heads/${target.branch}:refs/heads/${remoteBranch}`;
    const command = target.upstream
      ? `push origin ${shellQuote(refspec)}`
      : `push -u origin ${shellQuote(refspec)}`;
    await git(directory, command);
    const gitStatus = await getSessionGitStatus(directory);
    const upstream = gitStatus.upstreamBranch || `origin/${target.branch}`;
    return { operation: 'push', branch: target.branch, upstream, summary: `Pushed to ${upstream}.`, gitStatus };
  } catch (error) {
    const normalized = normalizeSyncError(error, 'push');
    normalized.gitStatus = await statusAfterSync(directory);
    throw normalized;
  }
}

export async function pullSessionBranch(directory) {
  let target;
  try {
    target = await getSyncTarget(directory, 'pull');
    const counts = await getAheadBehindCounts(directory, target.upstream);
    if (counts.aheadCount > 0 && counts.behindCount > 0) throw new GitSyncError('diverged');
    const upstreamBranch = target.upstream.slice('origin/'.length);
    await git(directory, `pull --ff-only origin ${shellQuote(upstreamBranch)}`);
    const gitStatus = await getSessionGitStatus(directory);
    return { operation: 'pull', branch: target.branch, upstream: target.upstream, summary: `Pulled ${target.upstream}.`, gitStatus };
  } catch (error) {
    const normalized = normalizeSyncError(error, 'pull');
    normalized.gitStatus = await statusAfterSync(directory);
    throw normalized;
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
