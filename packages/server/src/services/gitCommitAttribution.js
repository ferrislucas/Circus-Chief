import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { chmod, mkdir, writeFile } from 'fs/promises';

const execAsync = promisify(exec);

const DEFAULT_MANAGED_HOOKS_PATH = path.join(os.homedir(), '.circuschief', 'hooks');
let _managedHooksPath = DEFAULT_MANAGED_HOOKS_PATH;

/**
 * Get the managed hooks directory path.
 * Production code uses the real home directory; tests can override via _setManagedHooksPath().
 * @returns {string}
 */
export function getManagedHooksPath() {
  return _managedHooksPath;
}

/**
 * Override the managed hooks path (for testing only).
 * Restores the default when called with no arguments.
 * @param {string} [overridePath]
 */
export function _setManagedHooksPath(overridePath) {
  _managedHooksPath = overridePath ?? DEFAULT_MANAGED_HOOKS_PATH;
}

const ATTRIBUTION_CONFIG_KEY = 'circuschief.commitAttribution';
const ATTRIBUTION_ENV_KEY = 'CIRCUSCHIEF_COMMIT_ATTRIBUTION';

async function git(directory, command) {
  const { stdout } = await execAsync(`git ${command}`, { cwd: directory });
  return stdout.trim();
}

async function gitConfigValue(directory, key) {
  try {
    return await git(directory, `config --get ${key}`);
  } catch {
    return null;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildCommitMsgHook() {
  return `#!/bin/sh
set -eu

msg_file="$1"
trailer="\${${ATTRIBUTION_ENV_KEY}:-}"

[ -n "$trailer" ] || exit 0
[ -n "$(printf '%s' "$trailer" | tr -d '[:space:]')" ] || exit 0

if printf '%s' "$trailer" | grep '[[:cntrl:]]' >/dev/null 2>&1; then
  echo "${ATTRIBUTION_ENV_KEY} must be a canonical Co-authored-by: Name <email> trailer." >&2
  exit 1
fi

if ! printf '%s\\n' "$trailer" | grep -E '^Co-authored-by: [^<>[:space:]][^<>]* <[^[:space:]<>@]+@[^[:space:]<>@]+\\.[^[:space:]<>@]+>$' >/dev/null 2>&1; then
  echo "${ATTRIBUTION_ENV_KEY} must be a canonical Co-authored-by: Name <email> trailer." >&2
  exit 1
fi

if grep -F -x -i -- "$trailer" "$msg_file" >/dev/null 2>&1; then
  exit 0
fi

git interpret-trailers --trailer "$trailer" --in-place "$msg_file"
`;
}

export async function clearWorktreeCommitAttribution(worktreePath) {
  const managedHooksPath = getManagedHooksPath();
  const currentAttribution = await gitConfigValue(worktreePath, ATTRIBUTION_CONFIG_KEY);
  const currentHooksPath = await gitConfigValue(worktreePath, 'core.hooksPath');
  if (!currentAttribution && currentHooksPath !== managedHooksPath) {
    return false;
  }

  await git(worktreePath, 'config extensions.worktreeConfig true');

  if (currentAttribution) {
    try {
      await git(worktreePath, `config --worktree --unset ${ATTRIBUTION_CONFIG_KEY}`);
    } catch {
      // Unset is idempotent for callers that are clearing a value that was never set.
    }
  }

  if (currentHooksPath === managedHooksPath) {
    try {
      await git(worktreePath, 'config --worktree --unset core.hooksPath');
    } catch {
      // Unset is idempotent for callers that are clearing stale managed hook config.
    }
  }
  return false;
}

/**
 * Install/update managed commit attribution enforcement for a worktree.
 *
 * Runtime attribution is process-scoped: the hook reads
 * CIRCUSCHIEF_COMMIT_ATTRIBUTION from the `git commit` process environment.
 *
 * @param {string} worktreePath - The worktree directory
 * @returns {Promise<boolean>} True when a hook is installed or updated
 */
export async function ensureWorktreeCommitAttributionHook(worktreePath) {
  const managedHooksPath = getManagedHooksPath();

  await git(worktreePath, 'config extensions.worktreeConfig true');

  const currentHooksPath = await gitConfigValue(worktreePath, 'core.hooksPath');
  if (currentHooksPath && currentHooksPath !== managedHooksPath) {
    throw new Error(
      `Cannot install managed commit attribution hook: worktree already has core.hooksPath set to "${currentHooksPath}"`
    );
  }

  try {
    await git(worktreePath, `config --worktree --unset ${ATTRIBUTION_CONFIG_KEY}`);
  } catch {
    // Unset is idempotent for stale worktrees that never stored attribution.
  }

  await git(worktreePath, `config --worktree core.hooksPath ${shellQuote(managedHooksPath)}`);

  const hookPath = path.join(managedHooksPath, 'commit-msg');
  await mkdir(managedHooksPath, { recursive: true });
  await writeFile(hookPath, buildCommitMsgHook(), 'utf8');
  await chmod(hookPath, 0o755);
  return true;
}

export async function configureWorktreeCommitAttribution(worktreePath, _commitAttribution) {
  return ensureWorktreeCommitAttributionHook(worktreePath);
}
