import { spawn } from 'child_process';
import { homedir, userInfo } from 'os';
import path from 'path';
import {
  captureSpawnAttempt,
  createCapturedSpawnProcess,
  isE2ESpawnCaptureEnabled,
} from './e2eSpawnCapture.js';
import { getLoginShellEnv, mergeShellEnv } from './loginShellEnv.js';

/**
 * Get the directory containing the current Node.js executable.
 * Used to ensure child processes can find node even when using version managers.
 * @returns {string} Path to the directory containing the Node binary
 */
export function getNodeBinDir() {
  return path.dirname(process.execPath);
}

/**
 * Well-known user bin directories where git/gh-style tools live when the
 * server's PATH is sparse (GUI/daemon launches, minimal containers).
 * Appended only when missing; explicit user PATH order is never rewritten.
 */
const POSIX_USER_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

function pathContainsDir(pathValue, separator, dir) {
  return pathValue.split(separator).includes(dir);
}

function safeHomedir() {
  try {
    return homedir();
  } catch {
    return null;
  }
}

function safeUsername() {
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

/**
 * Ensure user-identity entries so tools spawned by an agent resolve the same
 * config and credentials as when the user runs them directly (gh hosts file,
 * gitconfig, ssh config all key off HOME; USER/LOGNAME off identity).
 * Explicit values always win; nothing is stripped.
 *
 * @param {Object} [baseEnv=process.env] - Base environment to extend
 * @returns {Object} Environment object with user identity ensured
 */
export function buildUserCredentialEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!env.HOME) {
    const home = safeHomedir();
    if (home) env.HOME = home;
  }
  if (!env.USER || !env.LOGNAME) {
    const username = safeUsername();
    if (username) {
      if (!env.USER) env.USER = username;
      if (!env.LOGNAME) env.LOGNAME = username;
    }
  }
  return env;
}

/**
 * Create environment with guaranteed Node.js in PATH.
 * Prepends the Node binary directory to PATH to ensure child processes can find node.
 * This is critical for npx users with nvm/fnm/volta where 'node' may not be in system PATH.
 *
 * Also ensures well-known user bin directories are present (so agent-spawned
 * git/gh resolve the same binaries the user runs) and fills HOME/USER/LOGNAME
 * fallbacks (so those tools find the user's config and credentials).
 *
 * Login-shell derivation (FR-2/FR-9/FR-10): the cached login-shell env is
 * merged UNDER the explicit baseEnv, so dotfile-configured PATH entries,
 * SSH_AUTH_SOCK, and user-exported vars flow through while explicit values
 * (and their PATH order) are never rewritten. Pass `opts.shellEnv` to inject
 * a fixture (tests) or skip the live probe; pass
 * `{ shellEnv: {} }` to disable derivation for one call.
 *
 * @param {Object} [baseEnv=process.env] - Base environment to extend
 * @param {Object} [opts] - Optional `{ shellEnv }` override (fixture or {}).
 * @returns {Object} Environment object with robust PATH
 */
export function createRobustEnv(baseEnv = process.env, opts = {}) {
  const shellEnv = opts.shellEnv !== undefined ? opts.shellEnv : probeShellEnvOrEmpty();
  const withShell = mergeShellEnv({ shellEnv, baseEnv });
  const nodeBinDir = getNodeBinDir();
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const currentPath = withShell.PATH || withShell.Path || '';
  // The user's existing entries are never dropped or reordered relative to
  // each other, so agent-spawned tools resolve the same binaries. User bin
  // dirs are appended only when missing, so re-applying never duplicates
  // them.
  // The Node bin dir is always first and appears exactly once (finding #6):
  // nested launches (yarn → vitest → worker) can hand us a PATH already
  // carrying duplicate copies of it, and re-prepending on every build would
  // compound them. Collapsing copies of *our own* dir preserves resolution
  // semantics while keeping every other entry — and its order — untouched.
  const pathParts = currentPath ? currentPath.split(pathSeparator).filter(Boolean) : [];
  let mergedPath = [nodeBinDir, ...pathParts.filter((dir) => dir !== nodeBinDir)].join(pathSeparator);
  if (process.platform !== 'win32') {
    for (const dir of POSIX_USER_BIN_DIRS) {
      if (!pathContainsDir(mergedPath, pathSeparator, dir)) {
        mergedPath = mergedPath ? `${mergedPath}${pathSeparator}${dir}` : dir;
      }
    }
  }

  return buildUserCredentialEnv({
    ...withShell,
    PATH: mergedPath,
  });
}

/**
 * Cached login-shell env for the merge path. Failures (or a disabled probe)
 * yield an empty derivation so startup falls back to snapshot behavior
 * (FR-13); the probe itself logs the cause once.
 * @returns {Object} Raw login-shell env or {}.
 */
function probeShellEnvOrEmpty() {
  const probed = getLoginShellEnv();
  return probed.ok ? probed.env : {};
}

/**
 * Create a custom spawn function for the Claude Agent SDK.
 * Replaces 'node' command with process.execPath and ensures PATH is correct.
 *
 * This solves the "spawn node ENOENT" error that occurs when:
 * - Users run the app via npx with Node version managers (nvm, fnm, volta)
 * - The system PATH doesn't include the Node binary directory
 *
 * @returns {Function} Spawn function compatible with SDK's spawnClaudeCodeProcess option
 */
export function createClaudeCodeSpawner() {
  return (options) => {
    const { command, args, cwd, env, signal } = options;
    if (isE2ESpawnCaptureEnabled()) {
      captureSpawnAttempt('claude-code', options);
      return createCapturedSpawnProcess('claude-code');
    }

    // Replace 'node' with the absolute path to the current Node executable
    // This ensures we use the same Node that's running our app
    const actualCommand = command === 'node' ? process.execPath : command;

    // Ensure PATH includes the directory containing Node
    const robustEnv = createRobustEnv(env);

    const stderrMode = robustEnv.DEBUG_CLAUDE_AGENT_SDK ? 'pipe' : 'ignore';

    return spawn(actualCommand, args, {
      cwd,
      stdio: ['pipe', 'pipe', stderrMode],
      signal,
      env: robustEnv,
      windowsHide: true,
    });
  };
}
