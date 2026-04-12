import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a hook script asynchronously (fire-and-forget)
 * @param {string} hookCommand - The shell command to execute
 * @param {string} workingDirectory - The directory to run the command in
 * @param {Object} context - Context variables to pass as environment variables
 * @param {string} context.sessionId - The session ID
 * @param {string} context.projectId - The project ID
 * @param {string} [context.sessionName] - The session name
 */
export function executeHookAsync(hookCommand, workingDirectory, context = {}) {
  if (!hookCommand) return;

  const env = {
    ...process.env,
    CIRCUSCHIEF_SESSION_ID: context.sessionId || '',
    CIRCUSCHIEF_PROJECT_ID: context.projectId || '',
    CIRCUSCHIEF_SESSION_NAME: context.sessionName || '',
  };

  execAsync(hookCommand, { cwd: workingDirectory, env, shell: true })
    .then(({ stdout, stderr }) => {
      if (stdout) console.log(`[Hook] stdout: ${stdout.trim()}`);
      if (stderr) console.warn(`[Hook] stderr: ${stderr.trim()}`);
    })
    .catch((error) => {
      console.error(`[Hook] Execution failed: ${error.message}`);
    });
}

/**
 * Execute a hook script and wait for the result
 * @param {string} hookCommand - The shell command to execute
 * @param {string} workingDirectory - The directory to run the command in
 * @param {Object} context - Context variables to pass as environment variables
 * @returns {Promise<{success: boolean, stdout?: string, stderr?: string, error?: string}>}
 */
export async function executeHook(hookCommand, workingDirectory, context = {}) {
  if (!hookCommand) {
    return { success: true, stdout: '', stderr: '' };
  }

  const env = {
    ...process.env,
    CIRCUSCHIEF_SESSION_ID: context.sessionId || '',
    CIRCUSCHIEF_PROJECT_ID: context.projectId || '',
    CIRCUSCHIEF_SESSION_NAME: context.sessionName || '',
  };

  try {
    const { stdout, stderr } = await execAsync(hookCommand, { cwd: workingDirectory, env, shell: true });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
