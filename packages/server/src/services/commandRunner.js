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
   * @param {Object} metadata - Optional metadata (sessionId, buttonId)
   * @returns {Promise<number>} Exit code
   */
  async run(runId, command, workingDirectory, onOutput, onComplete, onError, metadata = {}) {
    const { sessionId, buttonId } = metadata;

    return new Promise((resolve) => {
      try {
        const child = spawn('sh', ['-c', command], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Store process with metadata and output buffer
        const entry = {
          process: child,
          startTime: Date.now(),
          sessionId,
          buttonId,
          output: '',
        };
        this.processes.set(runId, entry);

        child.stdout.on('data', (data) => {
          const text = data.toString();
          entry.output += text;
          if (onOutput) onOutput(text);
        });

        child.stderr.on('data', (data) => {
          const text = data.toString();
          entry.output += text;
          if (onOutput) onOutput(text);
        });

        child.on('error', (err) => {
          const msg = `Failed to execute command: ${err.message}`;
          if (onError) onError(msg);
          this.processes.delete(runId);
          resolve(1);
        });

        child.on('close', (exitCode, signal) => {
          console.log(`[commandRunner.run] Process closed for runId: ${runId}, exitCode: ${exitCode}, signal: ${signal}`);
          this.processes.delete(runId);
          // If killed by signal, exitCode is null. Call onComplete with null to trigger error status
          if (onComplete) onComplete(exitCode, entry.output);
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
    if (!entry) {
      console.log(`[commandRunner.kill] Process not found for runId: ${runId}`);
      return false;
    }

    try {
      console.log(`[commandRunner.kill] Sending SIGTERM to runId: ${runId}, pid: ${entry.process.pid}`);
      entry.process.kill('SIGTERM');
      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        console.log(`[commandRunner.kill] Checking if process still exists for runId: ${runId}, pid: ${entry.process.pid}, killed: ${entry.process.killed}`);
        if (!entry.process.killed) {
          console.log(`[commandRunner.kill] Process still alive, sending SIGKILL to runId: ${runId}`);
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

  /**
   * Get all active runs for a specific session
   * @param {string} sessionId
   * @returns {Array} Array of run info objects
   */
  getRunsBySession(sessionId) {
    const runs = [];
    for (const [runId, entry] of this.processes) {
      if (entry.sessionId === sessionId) {
        runs.push({
          runId,
          buttonId: entry.buttonId,
          status: 'running',
          output: entry.output,
          startTime: entry.startTime,
        });
      }
    }
    return runs;
  }
}

// Singleton instance
export const commandRunner = new CommandRunner();
