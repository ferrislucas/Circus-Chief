import { spawn } from 'child_process';
import { databaseManager } from '../database.js';

/**
 * Service for running commands and managing their execution
 */
export class CommandRunner {
  constructor() {
    this.processes = new Map(); // runId -> { process, timeout }
  }

  /**
   * Run a command and stream output via callback
   * @param {string} runId - Unique identifier for this run
   * @param {string} command - The command to execute
   * @param {string} workingDirectory - Directory to run command in
   * @param {Function} onOutput - Callback for output: (text) => void
   * @param {Function} onComplete - Callback for completion: (exitCode) => void
   * @param {Function} onError - Callback for errors: (message) => void
   * @returns {Promise<number>} Exit code
   */
  async run(runId, command, workingDirectory, onOutput, onComplete, onError) {
    return new Promise((resolve) => {
      try {
        const child = spawn('sh', ['-c', command], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });

        this.processes.set(runId, { process: child, startTime: Date.now() });

        let output = '';

        child.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          if (onOutput) onOutput(text);
        });

        child.stderr.on('data', (data) => {
          const text = data.toString();
          output += text;
          if (onOutput) onOutput(text);
        });

        child.on('error', (err) => {
          const msg = `Failed to execute command: ${err.message}`;
          if (onError) onError(msg);
          this.processes.delete(runId);
          resolve(1);
        });

        child.on('close', (exitCode) => {
          this.processes.delete(runId);
          if (onComplete) onComplete(exitCode);
          resolve(exitCode || 0);
        });
      } catch (err) {
        const msg = `Error running command: ${err.message}`;
        if (onError) onError(msg);
        this.processes.delete(runId);
        resolve(1);
      }
    });
  }

  /**
   * Kill a running process
   * @param {string} runId
   * @returns {boolean} True if process was killed, false if not found
   */
  kill(runId) {
    const entry = this.processes.get(runId);
    if (!entry) return false;

    try {
      entry.process.kill('SIGTERM');
      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        if (!entry.process.killed) {
          entry.process.kill('SIGKILL');
        }
      }, 1000);
      return true;
    } catch (err) {
      console.error(`Error killing process ${runId}:`, err);
      return false;
    }
  }

  /**
   * Get all active runs
   * @returns {Map} Map of runId -> process info
   */
  getActiveRuns() {
    return new Map(this.processes);
  }

  /**
   * Check if a run is active
   * @param {string} runId
   * @returns {boolean}
   */
  isRunning(runId) {
    return this.processes.has(runId);
  }
}

// Singleton instance
export const commandRunner = new CommandRunner();
