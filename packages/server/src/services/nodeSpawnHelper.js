import { spawn } from 'child_process';
import path from 'path';

/**
 * Get the directory containing the current Node.js executable.
 * Used to ensure child processes can find node even when using version managers.
 * @returns {string} Path to the directory containing the Node binary
 */
export function getNodeBinDir() {
  return path.dirname(process.execPath);
}

/**
 * Create environment with guaranteed Node.js in PATH.
 * Prepends the Node binary directory to PATH to ensure child processes can find node.
 * This is critical for npx users with nvm/fnm/volta where 'node' may not be in system PATH.
 *
 * @param {Object} [baseEnv=process.env] - Base environment to extend
 * @returns {Object} Environment object with robust PATH
 */
export function createRobustEnv(baseEnv = process.env) {
  const nodeBinDir = getNodeBinDir();
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const currentPath = baseEnv.PATH || baseEnv.Path || '';

  return {
    ...baseEnv,
    PATH: `${nodeBinDir}${pathSeparator}${currentPath}`,
  };
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
