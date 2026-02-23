import { spawn } from 'child_process';
import { platform } from 'os';
import { commandRuns } from '../database.js';
import { createRobustEnv } from './nodeSpawnHelper.js';
import { TerminalOutputProcessor } from './terminalOutputProcessor.js';
import { ProcessRegistry } from './processRegistry.js';
import { OutputBuffer } from './outputBuffer.js';

// Re-export for backward compatibility
export { stripAnsiCodes, TerminalOutputProcessor } from './terminalOutputProcessor.js';

/**
 * Service for running commands and managing their execution
 */
export class CommandRunner {
  constructor() {
    this.registry = new ProcessRegistry();
    this.outputBuffer = new OutputBuffer(500);
  }

  // Expose processes via the registry for backward compatibility with tests
  get processes() {
    return this.registry.processes;
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

        // Wrap command with 'script' to allocate a pseudo-TTY
        // This ensures line-buffered output like a normal terminal, so output
        // streams in real-time instead of being block-buffered
        //
        // Platform-specific syntax (script command differs significantly between Linux and macOS):
        // - Linux: script -q -e -c "command" /dev/null
        //   * -q = quiet mode (no header/footer messages)
        //   * -e = return exit code of the child process (Linux only)
        //   * -c = run command
        //   * /dev/null = don't save to file
        // - macOS: script -q /dev/null sh -c "command"
        //   * -q = quiet mode
        //   * /dev/null = don't save to file
        //   * sh -c = execute command via shell (macOS doesn't support -c flag on script itself)
        const osType = platform();
        const isLinux = osType === 'linux';
        let wrappedCommand;

        if (isLinux) {
          wrappedCommand = `script -q -e -c ${JSON.stringify(command)} /dev/null`;
        } else {
          // macOS and other Unix-like systems use different script syntax
          wrappedCommand = `script -q /dev/null sh -c ${JSON.stringify(command)}`;
        }

        const child = spawn('sh', ['-c', wrappedCommand], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true, // Create a new process group for proper signal handling
          env: createRobustEnv(), // Ensure node is in PATH for npx users with nvm/fnm
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
          outputProcessor: new TerminalOutputProcessor(), // Simulates terminal cursor behavior
        };
        this.registry.set(runId, entry);

        // Set up output buffer flushing
        const flushOutputBuffer = this.outputBuffer.createFlushFn(runId, entry, sessionId, buttonId);
        this.outputBuffer.startTimer(entry, flushOutputBuffer);

        child.stdout.on('data', (data) => {
          const rawText = data.toString();
          // Use the terminal output processor to simulate cursor behavior
          // This handles overwrite-style progress animations correctly
          const text = entry.outputProcessor.process(rawText);
          if (text) {
            this.outputBuffer.append(entry, text);
            if (onOutput) onOutput(text);
          }
        });

        child.stderr.on('data', (data) => {
          const rawText = data.toString();
          // Use the terminal output processor to simulate cursor behavior
          const text = entry.outputProcessor.process(rawText);
          if (text) {
            this.outputBuffer.append(entry, text);
            if (onOutput) onOutput(text);
          }
        });

        child.on('error', (err) => {
          this.outputBuffer.clearTimer(entry);
          // Flush any remaining content from the terminal processor
          const remainingText = entry.outputProcessor.flush();
          if (remainingText) {
            this.outputBuffer.append(entry, remainingText);
          }
          flushOutputBuffer(); // Flush any remaining output to database
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
          this.registry.delete(runId);
          resolve(1);
        });

        child.on('close', (exitCode, signal) => {
          this.outputBuffer.clearTimer(entry);
          // Flush any remaining content from the terminal processor (incomplete final line)
          const remainingText = entry.outputProcessor.flush();
          if (remainingText) {
            this.outputBuffer.append(entry, remainingText);
            if (onOutput) onOutput(remainingText);
          }
          flushOutputBuffer(); // Flush any remaining output to database
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

          this.registry.delete(runId);
          // If killed by signal, exitCode is null. Call onComplete with null to trigger error status
          if (onComplete) onComplete(exitCode, entry.output);
          // Return non-zero exit code for signal termination (143 for SIGTERM)
          if (signal) {
            resolve(143);
          }
          resolve(exitCode || 0);
        });
      } catch (err) {
        const msg = `Error running command: ${err.message}`;
        console.error(`[commandRunner.run] Exception for runId: ${runId}`, err);
        if (onError) onError(msg);
        // Mark as error in database (if available) and persist the error message
        if (commandRuns && typeof commandRuns.complete === 'function') {
          try {
            commandRuns.complete(runId, 1, `[Error] ${msg}`);
          } catch (dbErr) {
            console.warn(`[commandRunner.run] Warning: Error marking failed run in database for runId: ${runId}`, dbErr.message);
          }
        }
        this.registry.delete(runId);
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
    const entry = this.registry.get(runId);
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
        if (this.registry.has(runId)) {
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
      this.outputBuffer.clearTimer(entry);
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
    return this.registry.getActiveRuns();
  }

  /**
   * Check if a run is active
   * @param {string} runId
   * @returns {boolean}
   */
  isRunning(runId) {
    return this.registry.isRunning(runId);
  }

  /**
   * Get all running commands for a project
   * Used for merging in-memory running commands with completed runs from the database
   * @param {string} projectId
   * @param {Function} getSessionById - Function to look up session by ID
   * @returns {Array} Running command runs
   */
  getRunningByProjectId(projectId, getSessionById) {
    return this.registry.getRunningByProjectId(projectId, getSessionById);
  }

  /**
   * Get all active runs for a specific session (both running and recent completed)
   * @param {string} sessionId
   * @returns {Array} Array of run info objects
   */
  getRunsBySession(sessionId) {
    return this.registry.getRunsBySession(sessionId);
  }
}

// Singleton instance
export const commandRunner = new CommandRunner();
