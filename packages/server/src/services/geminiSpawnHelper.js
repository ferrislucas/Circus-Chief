import { spawn } from 'child_process';
import { createRobustEnv } from './nodeSpawnHelper.js';
import {
  captureSpawnAttempt,
  createCapturedSpawnProcess,
  isE2ESpawnCaptureEnabled,
} from './e2eSpawnCapture.js';

/**
 * Create a custom spawn function for the Gemini CLI.
 *
 * Mirrors {@link createCodexSpawner} but for the `gemini` command.
 *
 * As with other CLI helpers:
 *   - The command 'node' is replaced with {@link process.execPath} so child
 *     processes use the same Node binary.
 *   - `createRobustEnv` guarantees the Node bin directory is on PATH.
 *
 * @returns {Function} Spawn function of shape (options) => childProcess
 */
export function createGeminiSpawner() {
  return (options) => {
    const { command, args, cwd, env, signal } = options;
    if (isE2ESpawnCaptureEnabled()) {
      captureSpawnAttempt('gemini', options);
      return createCapturedSpawnProcess('gemini');
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
