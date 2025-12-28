import { spawn } from 'child_process';
import { databaseManager, commandRuns } from '../database.js';

/**
 * Service for running commands and managing their execution
 */
export class CommandRunner {
  constructor() {
    this.processes = new Map(); // runId -> { process, timeout, outputBuffer, lastDbWrite }
    this.outputBufferFlushInterval = 500; // Flush buffered output every 500ms
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
        // Create database record for this run (if database is available)
        if (commandRuns && typeof commandRuns.create === 'function') {
          try {
            commandRuns.create({ id: runId, sessionId, buttonId });
            console.log(`[commandRunner.run] Created run record in database for runId: ${runId}`);
          } catch (dbErr) {
            console.warn(
              `[commandRunner.run] Warning: Failed to create database record for runId: ${runId}`,
              dbErr.message
            );
            // Continue without database persistence - the run will still work
          }
        }

        const child = spawn('sh', ['-c', command], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true, // Create a new process group for proper signal handling
        });

        // Store process with metadata and output buffer
        const entry = {
          process: child,
          startTime: Date.now(),
          sessionId,
          buttonId,
          output: '',
          outputBuffer: '', // Accumulate output for batch writes
          lastDbWrite: Date.now(),
          bufferFlushTimer: null,
        };
        this.processes.set(runId, entry);

        // Helper to flush buffered output to database
        const flushOutputBuffer = () => {
          if (entry.outputBuffer && sessionId && buttonId && commandRuns && typeof commandRuns.appendOutput === 'function') {
            try {
              commandRuns.appendOutput(runId, entry.outputBuffer);
              entry.lastDbWrite = Date.now();
            } catch (err) {
              console.warn(`[commandRunner.run] Warning: Error flushing output to database for runId: ${runId}`, err.message);
            }
            entry.outputBuffer = '';
          }
        };

        // Set up periodic buffer flushing
        const setupBufferTimer = () => {
          entry.bufferFlushTimer = setInterval(flushOutputBuffer, this.outputBufferFlushInterval);
        };

        const clearBufferTimer = () => {
          if (entry.bufferFlushTimer) {
            clearInterval(entry.bufferFlushTimer);
            entry.bufferFlushTimer = null;
          }
        };

        setupBufferTimer();

        child.stdout.on('data', (data) => {
          const text = data.toString();
          entry.output += text;
          entry.outputBuffer += text;
          if (onOutput) onOutput(text);
        });

        child.stderr.on('data', (data) => {
          const text = data.toString();
          entry.output += text;
          entry.outputBuffer += text;
          if (onOutput) onOutput(text);
        });

        child.on('error', (err) => {
          clearBufferTimer();
          flushOutputBuffer(); // Flush any remaining output
          const msg = `Failed to execute command: ${err.message}`;
          console.error(`[commandRunner.run] Error for runId: ${runId}`, err);
          if (onError) onError(msg);
          // Mark as error in database (if available)
          if (commandRuns && typeof commandRuns.complete === 'function') {
            try {
              commandRuns.complete(runId, 1, entry.output);
            } catch (dbErr) {
              console.warn(`[commandRunner.run] Warning: Error marking run as error in database for runId: ${runId}`, dbErr.message);
            }
          }
          this.processes.delete(runId);
          resolve(1);
        });

        child.on('close', (exitCode, signal) => {
          clearBufferTimer();
          flushOutputBuffer(); // Flush any remaining output
          console.log(
            `[commandRunner.run] Process closed for runId: ${runId}, exitCode: ${exitCode}, signal: ${signal}`
          );

          // Mark as complete in database (if available)
          if (commandRuns && typeof commandRuns.complete === 'function' && typeof commandRuns.markKilled === 'function') {
            try {
              if (signal) {
                // Process was killed by signal, treat as error
                commandRuns.markKilled(runId, entry.output);
              } else {
                // Normal completion
                commandRuns.complete(runId, exitCode || 0, entry.output);
              }
              console.log(`[commandRunner.run] Marked run as complete in database for runId: ${runId}`);
            } catch (dbErr) {
              console.warn(`[commandRunner.run] Warning: Error marking run as complete in database for runId: ${runId}`, dbErr.message);
            }
          }

          this.processes.delete(runId);
          // If killed by signal, exitCode is null. Call onComplete with null to trigger error status
          if (onComplete) onComplete(exitCode, entry.output);
          resolve(exitCode || 0);
        });
      } catch (err) {
        const msg = `Error running command: ${err.message}`;
        console.error(`[commandRunner.run] Exception for runId: ${runId}`, err);
        if (onError) onError(msg);
        // Mark as error in database (if available)
        if (commandRuns && typeof commandRuns.complete === 'function') {
          try {
            commandRuns.complete(runId, 1, '');
          } catch (dbErr) {
            console.warn(`[commandRunner.run] Warning: Error marking failed run in database for runId: ${runId}`, dbErr.message);
          }
        }
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
      const pid = entry.process.pid;
      console.log(`[commandRunner.kill] Sending SIGTERM to process group for runId: ${runId}, pid: ${pid}`);

      // Kill the entire process group (negative PID) to ensure child processes are also killed
      try {
        process.kill(-pid, 'SIGTERM');
      } catch (e) {
        // Fallback to killing just the process if process group kill fails
        console.log(`[commandRunner.kill] Process group kill failed, killing single process: ${e.message}`);
        entry.process.kill('SIGTERM');
      }

      // Give it a moment to terminate gracefully, then force kill
      setTimeout(() => {
        // Check if process is still in our map (not yet closed)
        if (this.processes.has(runId)) {
          console.log(`[commandRunner.kill] Process still running, sending SIGKILL to runId: ${runId}`);
          try {
            process.kill(-pid, 'SIGKILL');
          } catch (e) {
            // Fallback to killing just the process if process group kill fails
            try {
              entry.process.kill('SIGKILL');
            } catch (err) {
              // Process may have already exited
              console.log(`[commandRunner.kill] SIGKILL failed, process may have exited: ${err.message}`);
            }
          }
        } else {
          console.log(`[commandRunner.kill] Process already exited for runId: ${runId}`);
        }
      }, 1000);

      // Flush any remaining output (database mark as killed will be done in close event)
      if (entry.bufferFlushTimer) {
        clearInterval(entry.bufferFlushTimer);
        entry.bufferFlushTimer = null;
      }
      if (entry.outputBuffer && commandRuns && typeof commandRuns.appendOutput === 'function') {
        try {
          commandRuns.appendOutput(runId, entry.outputBuffer);
          entry.outputBuffer = '';
        } catch (err) {
          console.warn(
            `[commandRunner.kill] Warning: Error flushing output to database for runId: ${runId}`,
            err.message
          );
        }
      }
      // Note: We don't mark as killed here because the close event will handle it
      // This is to avoid race conditions where we mark it killed before the process actually closes

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
   * Get all active runs for a specific session (both running and recent completed)
   * @param {string} sessionId
   * @returns {Array} Array of run info objects
   */
  getRunsBySession(sessionId) {
    const runs = [];

    // Add currently running processes
    for (const [runId, entry] of this.processes) {
      if (entry.sessionId === sessionId) {
        runs.push({
          runId,
          buttonId: entry.buttonId,
          status: 'running',
          output: entry.output,
          exitCode: undefined,
          startedAt: entry.startTime,
        });
      }
    }

    // Add recent completed runs from database (last 1 hour)
    // Note: commandRuns might not be available in test environments
    if (commandRuns && typeof commandRuns.getRecentBySessionId === 'function') {
      try {
        const dbRuns = commandRuns.getRecentBySessionId(sessionId, 3600000, false);
        for (const dbRun of dbRuns) {
          // Don't duplicate running processes
          const isRunning = runs.some((r) => r.runId === dbRun.id);
          if (!isRunning) {
            runs.push({
              runId: dbRun.id,
              buttonId: dbRun.buttonId,
              status: dbRun.status,
              output: dbRun.output,
              exitCode: dbRun.exitCode,
              startedAt: dbRun.startedAt,
            });
          }
        }
      } catch (err) {
        console.error(
          `[commandRunner.getRunsBySession] Error fetching database runs for sessionId: ${sessionId}`,
          err
        );
      }
    }

    return runs;
  }
}

// Singleton instance
export const commandRunner = new CommandRunner();
