import path from 'path';
import { realpath, access } from 'fs/promises';
import { isGitRepo, getWorktrees, git } from './gitService.js';

/**
 * Normalize a git remote URL into a clean HTTPS browser URL.
 *
 * Supported forms:
 *   - https://github.com/owner/repo.git -> https://github.com/owner/repo
 *   - https://github.com/owner/repo     -> https://github.com/owner/repo (already clean)
 *   - git@github.com:owner/repo.git    -> https://github.com/owner/repo
 *   - ssh://git@github.com/owner/repo.git -> https://github.com/owner/repo
 *   - git@gitlab.com:owner/repo.git    -> https://gitlab.com/owner/repo
 *   - https://gitlab.com/owner/repo.git -> https://gitlab.com/owner/repo
 *   - https://bitbucket.org/owner/repo.git -> https://bitbucket.org/owner/repo
 *   - http://git.example.com/owner/repo.git -> http://git.example.com/owner/repo
 *   - git://github.com/owner/repo.git  -> https://github.com/owner/repo
 *
 * Query strings and fragments are stripped before matching.
 *
 * Returns null for empty, null, undefined, or unrecognizable inputs.
 *
 * @param {string|null|undefined} remoteUrl
 * @returns {string|null}
 */
export function normalizeGitRemoteUrl(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Strip query strings and fragments before matching
  // (defensive: malformed remote configs shouldn't silently fail)
  const cleaned = trimmed.replace(/[?#].*$/, '');

  // SSH form: git@host:owner/repo.git or git@host:owner/repo
  const sshMatch = cleaned.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  // SSH protocol form: ssh://git@host/owner/repo.git
  const sshProtocolMatch = cleaned.match(/^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshProtocolMatch) {
    return `https://${sshProtocolMatch[1]}/${sshProtocolMatch[2]}`;
  }

  // HTTPS form: https://host/owner/repo.git or https://host/owner/repo
  const httpsMatch = cleaned.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // HTTP form: http://host/owner/repo.git or http://host/owner/repo
  // Preserve the http:// scheme (unlike SSH->HTTPS conversion, HTTP remotes
  // are intentional and the server may not support HTTPS).
  const httpMatch = cleaned.match(/^http:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpMatch) {
    return `http://${httpMatch[1]}/${httpMatch[2]}`;
  }

  // git:// protocol form: git://host/owner/repo.git or git://host/owner/repo
  // Convert to HTTPS (same output as SSH).
  const gitProtocolMatch = cleaned.match(/^git:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (gitProtocolMatch) {
    return `https://${gitProtocolMatch[1]}/${gitProtocolMatch[2]}`;
  }

  // Unrecognized format
  return null;
}

/**
 * Parse the first remote URL from `git remote -v` output.
 * @param {string} remoteVerbose - Raw output of `git remote -v`
 * @returns {string|null} The extracted URL, or null if not parseable
 */
function parseFirstRemoteUrl(remoteVerbose) {
  const firstLine = remoteVerbose.split('\n').find((r) => r.trim());
  if (!firstLine) return null;

  // git remote -v outputs: "remote_name\turl (fetch)"
  const parts = firstLine.split('\t');
  if (parts.length < 2) return null;

  return parts[1].replace(/ \((?:fetch|push)\)$/, '');
}

/**
 * Auto-detect the repository URL from a directory's git remotes.
 *
 * Prefers the "origin" remote. Falls back to the first configured remote.
 * Normalizes SSH and HTTPS URLs into clean HTTPS browser URLs.
 * Returns null if the directory is not a git repo or has no usable remotes.
 *
 * @param {string} directory
 * @returns {Promise<string|null>}
 */
export async function getRepositoryUrl(directory) {
  try {
    // Fast-path: skip entirely if the directory is not a git repo.
    // Uses a filesystem check (.git existence) instead of spawning a git process,
    // which avoids unnecessary child_process overhead for non-git directories.
    try {
      await access(path.join(directory, '.git'));
    } catch {
      return null;
    }

    // Try origin first (with timeout to prevent indefinite blocking under load)
    let rawUrl;
    try {
      rawUrl = await git(directory, 'config --get remote.origin.url', { timeout: 5000 });
    } catch {
      // No origin remote, try listing all remotes
    }

    // Fall back to first remote if origin doesn't exist
    if (!rawUrl) {
      try {
        const remoteVerbose = await git(directory, 'remote -v', { timeout: 5000 });
        rawUrl = parseFirstRemoteUrl(remoteVerbose);
      } catch {
        // No remotes at all
      }
    }

    if (!rawUrl) {
      return null;
    }

    return normalizeGitRemoteUrl(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Detect the worktree path for a directory by inspecting existing worktrees.
 * If external worktrees exist, uses the parent directory of the first one.
 * Otherwise, falls back to {directory}/.worktrees.
 * @param {string} directory - The git repository directory
 * @returns {Promise<{worktreePath: string, source: 'detected' | 'default'}>}
 */
export async function detectWorktreePath(directory) {
  const isRepo = await isGitRepo(directory);
  if (!isRepo) {
    return { worktreePath: path.join(directory, '.worktrees'), source: 'default' };
  }

  // Resolve symlinks for consistent path comparison (e.g., /var -> /private/var on macOS)
  let resolvedDir;
  try {
    resolvedDir = await realpath(directory);
  } catch {
    resolvedDir = path.resolve(directory);
  }

  const worktrees = await getWorktrees(directory);
  // Filter out the main worktree (its path === directory or resolves to it)
  const externalWorktrees = worktrees.filter(wt => path.resolve(wt.path) !== resolvedDir);

  if (externalWorktrees.length > 0) {
    // Use the parent directory of the first external worktree
    const parentDir = path.dirname(path.resolve(externalWorktrees[0].path));
    return { worktreePath: parentDir, source: 'detected' };
  }

  return { worktreePath: path.join(resolvedDir, '.worktrees'), source: 'default' };
}
