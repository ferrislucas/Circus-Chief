import { spawn } from 'child_process';
import { platform } from 'os';
import { commandRuns } from '../database.js';
import { createRobustEnv } from './nodeSpawnHelper.js';

/**
 * Strip ANSI escape codes from text
 * Removes all CSI (Control Sequence Introducer) sequences:
 * - SGR codes: \x1b[...m (colors, bold, italic, etc.)
 * - Cursor movement: \x1b[1A, \x1b[2B, etc.
 * - Line/screen clearing: \x1b[2K, \x1b[0J, etc.
 * - Other CSI sequences: \x1b[...H, \x1b[...J, etc.
 *
 * @param {string} text - Text potentially containing ANSI codes
 * @returns {string} Text with all ANSI codes removed
 */
export function stripAnsiCodes(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Match all CSI sequences: ESC [ <params> <final-char>
  // This covers colors, cursor movement, line clearing, and other terminal control sequences
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * Terminal output processor that simulates cursor control behavior
 *
 * When tools like yarn run in TTY mode, they use cursor control sequences to create
 * animated progress displays. For example:
 *   \x1b[2K\x1b[1G[] 0/576    <- clear line, go to column 1, print progress
 *   \x1b[2K\x1b[1G[] 136/576  <- clear line, go to column 1, print NEW progress
 *
 * On a real terminal, the second line overwrites the first. But when we just strip
 * the codes, we get "[] 0/576[] 136/576" concatenated together.
 *
 * This processor simulates the terminal behavior by:
 * 1. Maintaining a "current line" buffer (content since last newline)
 * 2. When we see \x1b[2K (clear line), we clear the current line buffer
 * 3. When we see \x1b[1G (cursor to column 1), we clear the current line buffer
 * 4. When we see \r (carriage return), we clear the current line buffer
 * 5. When we see \n, we flush the current line and start fresh
 * 6. All ANSI escape codes are stripped from output
 */
export class TerminalOutputProcessor {
  constructor() {
    /** @type {string} Content on the current line (since last newline) */
    this.currentLine = '';
  }

  /**
   * Handle a CSI (Control Sequence Introducer) command
   * Returns true if the current line should be cleared
   * @param {string} cmd - The command character
   * @param {string} params - The parameters string
   * @returns {boolean} Whether to clear the current line
   */
  #shouldClearLineForCSI(cmd, params) {
    // Erase in Line: [0K = to end, [1K = to start, [2K = entire line
    if (cmd === 'K') return true;
    // Cursor Character Absolute: [1G = go to column 1 (start of line)
    if (cmd === 'G' && (params === '' || params === '1')) return true;
    // Cursor Position: [n;mH or [n;mf moves cursor to row n, column m
    if (cmd === 'H' || cmd === 'f') return true;
    // Cursor movement: A=up, B=down, C=right, D=left
    if (cmd === 'A' || cmd === 'B' || cmd === 'C' || cmd === 'D') return true;
    // Erase in Display: [0J = to end, [1J = to start, [2J = entire screen
    if (cmd === 'J') return true;
    return false;
  }

  /**
   * Process a chunk of terminal output, simulating cursor control behavior
   *
   * @param {string} chunk - Raw terminal output chunk
   * @returns {string} Processed output with cursor behavior simulated and ANSI codes stripped
   */
  process(chunk) {
    if (!chunk || typeof chunk !== 'string') {
      return '';
    }

    let output = '';
    let i = 0;

    while (i < chunk.length) {
      // Check for ESC sequence
      if (chunk[i] === '\x1b' && chunk[i + 1] === '[') {
        // Parse the CSI sequence: ESC [ <params> <command>
        let j = i + 2;
        while (j < chunk.length && /[0-9;?]/.test(chunk[j])) {
          j++;
        }

        if (j < chunk.length) {
          const cmd = chunk[j];
          const params = chunk.slice(i + 2, j);

          // Handle cursor control sequences that affect line content
          if (this.#shouldClearLineForCSI(cmd, params)) {
            this.currentLine = '';
          }
          // All other sequences (including color codes 'm') are just stripped

          i = j + 1;
          continue;
        }
      }

      // Handle carriage return - go to start of line (used for overwriting)
      if (chunk[i] === '\r') {
        // Don't clear if next char is \n (normal line ending)
        if (chunk[i + 1] !== '\n') {
          this.currentLine = '';
        }
        i++;
        continue;
      }

      // Handle newline - flush current line and start fresh
      if (chunk[i] === '\n') {
        output += this.currentLine + '\n';
        this.currentLine = '';
        i++;
        continue;
      }

      // Regular character - add to current line
      this.currentLine += chunk[i];
      i++;
    }

    return output;
  }

  /**
   * Flush any remaining content in the current line buffer
   * Call this when the stream ends to get the final incomplete line
   *
   * @returns {string} Any remaining content
   */
  flush() {
    const remaining = this.currentLine;
    this.currentLine = '';
    return remaining;
  }

  /**
   * Reset the processor state
   */
  reset() {
    this.currentLine = '';
  }
}

/**
 * Service for running commands and managing their execution
 */
export class CommandRunner {
  constructor() {
    this.processes = new Map(); // runId -> { process, timeout, outputBuffer, lastDbWrite }
    this.outputBufferFlushInterval = 500; // Flush buffered output every 500ms
  }

  /**
   * Create database record for a command run.
   */
  #createDatabaseRecord(runId, sessionId, buttonId) {
    if (!commandRuns || typeof commandRuns.create !== 'function') return;
    try {
      commandRuns.create({ id: runId, sessionId, buttonId });
      console.log(`[commandRunner.run] Created run record in database for runId: ${runId}`);
    } catch (dbErr) {
      console.warn(`[commandRunner.run] Warning: Failed to create database record for runId: ${runId}`, dbErr.message);
    }
  }

  /**
   * Wrap command with platform-specific TTY allocation.
   */
  #wrapCommandForPlatform(command) {
    const osType = platform();
    if (osType === 'linux') {
      return `script -q -e -c ${JSON.stringify(command)} /dev/null`;
    }
    return `script -q /dev/null sh -c ${JSON.stringify(command)}`;
  }

  /**
   * Create process entry with buffer management.
   */
  #createProcessEntry(child, sessionId, buttonId) {
    return {
      process: child,
      startTime: Date.now(),
      sessionId,
      buttonId,
      output: '',
      outputBuffer: '',
      lastDbWrite: Date.now(),
      bufferFlushTimer: null,
      outputProcessor: new TerminalOutputProcessor(),
    };
  }

  /**
   * Flush buffered output to database.
   */
  #flushOutputBuffer(entry, runId) {
    if (!entry.outputBuffer) return;
    if (!entry.sessionId || !entry.buttonId) return;
    if (!commandRuns || typeof commandRuns.appendOutput !== 'function') return;
    try {
      commandRuns.appendOutput(runId, entry.outputBuffer);
      entry.lastDbWrite = Date.now();
    } catch (err) {
      console.warn(`[commandRunner.run] Warning: Error flushing output to database for runId: ${runId}`, err.message);
    }
    entry.outputBuffer = '';
  }

  /**
   * Handle process close event.
   * @param {{ entry: object, runId: string, exitCode: number|null, signal: string|null }} ctx
   * @param {function|undefined} onComplete - Completion callback
   */
  #handleProcessClose(ctx, onComplete) {
    const { entry, runId, exitCode, signal } = ctx;
    const remainingText = entry.outputProcessor.flush();
    if (remainingText) {
      entry.output += remainingText;
      entry.outputBuffer += remainingText;
    }
    this.#flushOutputBuffer(entry, runId);
    console.log(`[commandRunner.run] Process closed for runId: ${runId}, exitCode: ${exitCode}, signal: ${signal}`);

    if (commandRuns && typeof commandRuns.complete === 'function' && typeof commandRuns.markKilled === 'function') {
      try {
        if (signal) {
          commandRuns.markKilled(runId, entry.output);
        } else {
          commandRuns.complete(runId, exitCode || 0, entry.output);
        }
        console.log(`[commandRunner.run] Marked run as complete in database for runId: ${runId}`);
      } catch (dbErr) {
        console.warn(`[commandRunner.run] Warning: Error marking run as complete in database for runId: ${runId}`, dbErr.message);
      }
    }

    this.processes.delete(runId);
    if (onComplete) onComplete(exitCode, entry.output);
    return exitCode ?? 1;
  }

  /**
   * Run a command and stream output via callback
   *
   * @param {{ runId: string, command: string, workingDirectory: string }} params - Command parameters
   * @param {{ onOutput?: function, onComplete?: function, onError?: function }} callbacks - Callback functions
   * @param {{ sessionId?: string, buttonId?: string }} metadata - Optional metadata
   * @returns {Promise<number>} Exit code
   */
  async run(params, callbacks = {}, metadata = {}) {
    const { runId, command, workingDirectory } = params;
    const { onOutput, onComplete, onError } = callbacks;
    const { sessionId, buttonId } = metadata;

    return new Promise((resolve) => {
      try {
        this.#createDatabaseRecord(runId, sessionId, buttonId);
        const wrappedCommand = this.#wrapCommandForPlatform(command);

        const child = spawn('sh', ['-c', wrappedCommand], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
          env: createRobustEnv(),
        });

        const entry = this.#createProcessEntry(child, sessionId, buttonId);
        this.processes.set(runId, entry);

        // Buffer timer management
        const clearBufferTimer = () => {
          if (entry.bufferFlushTimer) {
            clearInterval(entry.bufferFlushTimer);
            entry.bufferFlushTimer = null;
          }
        };
        entry.bufferFlushTimer = setInterval(() => this.#flushOutputBuffer(entry, runId), this.outputBufferFlushInterval);

        // Data handler for both stdout and stderr
        const handleData = (data) => {
          const text = entry.outputProcessor.process(data.toString());
          if (text) {
            entry.output += text;
            entry.outputBuffer += text;
            if (onOutput) onOutput(text);
          }
        };

        child.stdout.on('data', handleData);
        child.stderr.on('data', handleData);

        child.on('error', (err) => {
          clearBufferTimer();
          const remainingText = entry.outputProcessor.flush();
          if (remainingText) {
            entry.output += remainingText;
            entry.outputBuffer += remainingText;
          }
          this.#flushOutputBuffer(entry, runId);
          const msg = `Failed to execute command: ${err.message}`;
          console.error(`[commandRunner.run] Error for runId: ${runId}`, err);
          if (onError) onError(msg);
          if (commandRuns && typeof commandRuns.complete === 'function') {
            try { commandRuns.complete(runId, 1, entry.output); } catch { /* ignore */ }
          }
          this.processes.delete(runId);
          resolve(1);
        });

        child.on('close', (exitCode, signal) => {
          clearBufferTimer();
          const remainingText = entry.outputProcessor.flush();
          if (remainingText) {
            entry.output += remainingText;
            entry.outputBuffer += remainingText;
            if (onOutput) onOutput(remainingText);
          }
          resolve(this.#handleProcessClose({ entry, runId, exitCode, signal }, onComplete));
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
   * Get all running commands for a project
   * Used for merging in-memory running commands with completed runs from the database
   * @param {string} projectId
   * @param {Function} getSessionById - Function to look up session by ID
   * @returns {Array} Running command runs
   */
  getRunningByProjectId(projectId, getSessionById) {
    const results = [];
    for (const [runId, entry] of this.processes.entries()) {
      // Look up session to check projectId
      const session = getSessionById(entry.sessionId);
      if (session?.projectId === projectId) {
        results.push({
          id: runId,
          runId: runId,
          buttonId: entry.buttonId,
          sessionId: entry.sessionId,
          status: 'running',
          output: entry.output,
          exitCode: null,
          startedAt: entry.startTime,
        });
      }
    }
    return results;
  }

  /**
   * Get all active runs for a specific session (both running and recent completed)
   * @param {string} sessionId
   * @returns {Array} Array of run info objects
   */
  /**
   * Mark an orphaned run as error in the database
   * @param {Object} dbRun - The database run record
   */
  #markOrphanedRunAsError(dbRun) {
    console.log(
      `[commandRunner.getRunsBySession] Orphaned run detected: ${dbRun.id}, marking as error`
    );
    if (typeof commandRuns.complete === 'function') {
      try {
        commandRuns.complete(dbRun.id, -1, dbRun.output || '');
      } catch (updateErr) {
        console.warn(
          `[commandRunner.getRunsBySession] Failed to update orphaned run: ${updateErr.message}`
        );
      }
    }
  }

  /**
   * Process a database run record and return a normalized run object
   * @param {Object} dbRun - The database run record
   * @returns {Object} Normalized run object
   */
  #processDbRun(dbRun) {
    let status = dbRun.status;
    let exitCode = dbRun.exitCode;

    // If DB shows "running" but we don't have the process in memory,
    // it's an orphaned run (server restarted, process died unexpectedly, etc.)
    if (dbRun.status === 'running' && !this.processes.has(dbRun.id)) {
      this.#markOrphanedRunAsError(dbRun);
      status = 'error';
      exitCode = -1;
    }

    return {
      runId: dbRun.id,
      buttonId: dbRun.buttonId,
      status,
      output: dbRun.output,
      exitCode,
      startedAt: dbRun.startedAt,
    };
  }

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

    // Add latest completed runs from database (one per button, no time limit)
    // Note: commandRuns might not be available in test environments
    if (commandRuns && typeof commandRuns.getLatestRunsForSession === 'function') {
      try {
        const dbRuns = commandRuns.getLatestRunsForSession(sessionId);
        for (const dbRun of dbRuns) {
          // Don't duplicate running processes
          const isRunningInMemory = runs.some((r) => r.runId === dbRun.id);
          if (!isRunningInMemory) {
            runs.push(this.#processDbRun(dbRun));
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
