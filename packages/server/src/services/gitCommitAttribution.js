import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { chmod, mkdir, writeFile } from 'fs/promises';

const execAsync = promisify(exec);
const MANAGED_HOOKS_PATH = '.circuschief-hooks';
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
  const currentAttribution = await gitConfigValue(worktreePath, ATTRIBUTION_CONFIG_KEY);
  const currentHooksPath = await gitConfigValue(worktreePath, 'core.hooksPath');
  if (!currentAttribution && currentHooksPath !== MANAGED_HOOKS_PATH) {
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

  if (currentHooksPath === MANAGED_HOOKS_PATH) {
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
  await git(worktreePath, 'config extensions.worktreeConfig true');

  // Clear any inherited worktree-level hooksPath before checking.
  // When a session worktree is created inside another worktree (e.g. E2E tests
  // running inside a Circus Chief-managed worktree), the new worktree may
  // inherit the parent's core.hooksPath.  Since we are about to install our
  // own managed hook, clear any stale inherited value first.
  const currentHooksPath = await gitConfigValue(worktreePath, 'core.hooksPath');
  if (currentHooksPath && currentHooksPath !== MANAGED_HOOKS_PATH) {
    try {
      await git(worktreePath, 'config --worktree --unset core.hooksPath');
    } catch {
      // If unset fails, fall through to the safety check below.
    }
    // Re-read after clearing — if a non-worktree-level config is still
    // present (e.g. local/common config), that's a genuine conflict.
    const afterClear = await gitConfigValue(worktreePath, 'core.hooksPath');
    if (afterClear && afterClear !== MANAGED_HOOKS_PATH) {
      throw new Error(
        `Cannot install managed commit attribution hook: worktree already has core.hooksPath set to "${afterClear}"`
      );
    }
  }

  try {
    await git(worktreePath, `config --worktree --unset ${ATTRIBUTION_CONFIG_KEY}`);
  } catch {
    // Unset is idempotent for stale worktrees that never stored attribution.
  }

  await git(worktreePath, `config --worktree core.hooksPath ${shellQuote(MANAGED_HOOKS_PATH)}`);

  const hooksDir = path.join(worktreePath, MANAGED_HOOKS_PATH);
  const hookPath = path.join(hooksDir, 'commit-msg');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(hookPath, buildCommitMsgHook(), 'utf8');
  await chmod(hookPath, 0o755);
  return true;
}

export async function configureWorktreeCommitAttribution(worktreePath, _commitAttribution) {
  return ensureWorktreeCommitAttributionHook(worktreePath);
}
