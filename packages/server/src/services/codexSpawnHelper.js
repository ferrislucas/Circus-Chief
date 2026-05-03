import { spawn } from 'child_process';
import { createRobustEnv } from './nodeSpawnHelper.js';
import {
  captureSpawnAttempt,
  createCapturedSpawnProcess,
  isE2ESpawnCaptureEnabled,
} from './e2eSpawnCapture.js';

/**
 * Create a custom spawn function for the Codex CLI.
 *
 * Mirrors {@link createClaudeCodeSpawner} but keeps stderr piped (the Codex
 * adapter surfaces stderr bytes as error events rather than silently ignoring
 * them).
 *
 * As with the Claude helper:
 *   - The command 'node' is replaced with {@link process.execPath} so child
 *     processes use the same Node binary that's running the app (important
 *     for nvm/fnm/volta users).
 *   - `createRobustEnv` guarantees the Node bin directory is on PATH.
 *
 * @returns {Function} Spawn function of shape (options) => childProcess
 */
export function createCodexSpawner() {
  return (options) => {
    const { command, args, cwd, env, signal } = options;
    if (isE2ESpawnCaptureEnabled()) {
      captureSpawnAttempt('codex', options);
      return createCapturedSpawnProcess('codex');
    }

    // Replace 'node' with the absolute path to the current Node executable
    const actualCommand = command === 'node' ? process.execPath : command;

    // Ensure PATH includes the directory containing Node
    const robustEnv = createRobustEnv(env);

    return spawn(actualCommand, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
      env: robustEnv,
      windowsHide: true,
    });
  };
}
