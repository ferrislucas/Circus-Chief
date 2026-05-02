import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { chmod, mkdir, writeFile } from 'fs/promises';

const execAsync = promisify(exec);
const MANAGED_HOOKS_PATH = '.circuschief-hooks';
const ATTRIBUTION_CONFIG_KEY = 'circuschief.commitAttribution';

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
attribution="$(git config --get ${ATTRIBUTION_CONFIG_KEY} || true)"

[ -n "$attribution" ] || exit 0

case "$attribution" in
  [Cc][Oo]-[Aa][Uu][Tt][Hh][Oo][Rr][Ee][Dd]-[Bb][Yy]:*)
    trailer="$attribution"
    ;;
  *)
    trailer="Co-authored-by: $attribution"
    ;;
esac

if grep -F -x -i -- "$trailer" "$msg_file" >/dev/null 2>&1; then
  exit 0
fi

git interpret-trailers --trailer "$trailer" --in-place "$msg_file"
`;
}

async function clearWorktreeCommitAttribution(worktreePath) {
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
 * Attribution is stored in worktree-local Git config so each managed session
 * can enforce a different trailer while preserving the human Git identity.
 *
 * @param {string} worktreePath - The worktree directory
 * @param {string|null} commitAttribution - Name/email or complete Co-authored-by trailer
 * @returns {Promise<boolean>} True when a hook is installed or updated
 */
export async function configureWorktreeCommitAttribution(worktreePath, commitAttribution) {
  const normalizedAttribution = typeof commitAttribution === 'string'
    ? commitAttribution.trim()
    : '';

  if (!normalizedAttribution) {
    return clearWorktreeCommitAttribution(worktreePath);
  }

  await git(worktreePath, 'config extensions.worktreeConfig true');

  const currentHooksPath = await gitConfigValue(worktreePath, 'core.hooksPath');
  if (currentHooksPath && currentHooksPath !== MANAGED_HOOKS_PATH) {
    throw new Error(
      `Cannot install managed commit attribution hook: worktree already has core.hooksPath set to "${currentHooksPath}"`
    );
  }

  await git(
    worktreePath,
    `config --worktree ${ATTRIBUTION_CONFIG_KEY} ${shellQuote(normalizedAttribution)}`
  );
  await git(worktreePath, `config --worktree core.hooksPath ${shellQuote(MANAGED_HOOKS_PATH)}`);

  const hooksDir = path.join(worktreePath, MANAGED_HOOKS_PATH);
  const hookPath = path.join(hooksDir, 'commit-msg');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(hookPath, buildCommitMsgHook(), 'utf8');
  await chmod(hookPath, 0o755);
  return true;
}
