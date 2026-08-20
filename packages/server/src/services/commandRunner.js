import { spawn } from 'child_process';
import { commandRuns } from '../database.js';
import { TerminalOutputProcessor } from './terminalOutput.js';
import { commandOutputMetrics, COMMAND_OUTPUT_METRICS } from './commandOutputMetrics.js';
import { createCommandRunnerEnv, wrapCommandForPlatform } from './commandRunnerPlatform.js';

// Re-export for backward compatibility
export { stripAnsiCodes, TerminalOutputProcessor } from './terminalOutput.js';
export { createCommandRunnerEnv, wrapCommandForPlatform } from './commandRunnerPlatform.js';

/**
 * Service for running commands and managing their execution
 */
export class CommandRunner {
  constructor({ outputBroadcastInterval = 250, outputDbFlushInterval = 500, outputBufferMaxBytes = 64 * 1024 } = {}) {
    this.processes = new Map();
    this.outputBroadcastInterval = outputBroadcastInterval;
    this.outputBufferFlushInterval = outputDbFlushInterval;
    this.outputBufferMaxBytes = outputBufferMaxBytes;
  }

  /**
   * Create database record for a command run.
   */
  #createDatabaseRecord(runId, sessionId, buttonId) {
    if (!sessionId || !buttonId) return;
    if (!commandRuns || typeof commandRuns.create !== 'function') return;
    try {
      commandRuns.create({ id: runId, sessionId, buttonId });
      console.log(`[commandRunner.run] Created run record in database for runId: ${runId}`);
    } catch (dbErr) {
      console.warn(`[commandRunner.run] Warning: Failed to create database record for runId: ${runId}`, dbErr.message);
    }
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
      outputChunks: [],
      outputBytes: 0,
      lastDbWrite: Date.now(),
      bufferFlushTimer: null,
      broadcastFlushTimer: null,
      finalized: false,
      outputProcessor: new TerminalOutputProcessor(),
    };
  }

  /**
   * Flush buffered output to database.
   */
  #flushOutputBuffer(entryInput, runId) {
    const entry = entryInput;
    if (!entry.outputChunks.length) return;
    const chunks = entry.outputChunks;
    entry.outputChunks = [];
    entry.outputBytes = 0;
    entry.onOutput?.(chunks.join(''));
    if (!entry.sessionId || !entry.buttonId) return;
    if (!commandRuns || typeof commandRuns.appendBatch !== 'function') return;
    const startedAt = performance.now();
    commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.FLUSH_COUNT);
    try {
      const persisted = commandRuns.appendBatch(runId, chunks);
      commandOutputMetrics.increment(
        COMMAND_OUTPUT_METRICS.PERSISTED_BYTES,
        chunks.reduce((bytes, chunk) => bytes + Buffer.byteLength(chunk), 0),
      );
      for (const chunk of persisted) entry.onOutputChunk?.(chunk);
      Object.assign(entry, { lastDbWrite: Date.now() });
    } catch (err) {
      commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.FLUSH_FAILURES);
      console.warn(`[commandRunner.run] Warning: Error flushing output to database for runId: ${runId}`, err.message);
    } finally {
      commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.FLUSH_DURATION_MS, performance.now() - startedAt);
    }
  }

  #appendOutput(entry, text) {
    if (!text) return;
    commandOutputMetrics.increment(COMMAND_OUTPUT_METRICS.PRODUCED_BYTES, Buffer.byteLength(text));
    Object.assign(entry, {
      outputChunks: [...entry.outputChunks, text],
      outputBytes: entry.outputBytes + Buffer.byteLength(text),
    });
  }

  #clearFlushTimers(entry) {
    if (entry.bufferFlushTimer) clearInterval(entry.bufferFlushTimer);
    if (entry.broadcastFlushTimer) clearInterval(entry.broadcastFlushTimer);
    Object.assign(entry, { bufferFlushTimer: null, broadcastFlushTimer: null });
  }

  /**
   * Handle process close event.
   * @param {{ entry: object, runId: string, exitCode: number|null, signal: string|null }} ctx
   * @param {function|undefined} onComplete - Completion callback
   */
  #handleProcessClose(ctx, onComplete) {
    const { entry, runId, exitCode, signal } = ctx;
    if (entry.finalized) return exitCode ?? 1;
    entry.finalized = true;
    this.#clearFlushTimers(entry);
    const remainingText = entry.outputProcessor.flush();
    this.#appendOutput(entry, remainingText);
    this.#flushOutputBuffer(entry, runId);
    console.log(`[commandRunner.run] Process closed for runId: ${runId}, exitCode: ${exitCode}, signal: ${signal}`);

    if (commandRuns && typeof commandRuns.complete === 'function' && typeof commandRuns.markKilled === 'function') {
      try {
        if (signal) {
          commandRuns.markKilled(runId);
        } else {
          commandRuns.complete(runId, exitCode || 0);
        }
        console.log(`[commandRunner.run] Marked run as complete in database for runId: ${runId}`);
      } catch (dbErr) {
        console.warn(`[commandRunner.run] Warning: Error marking run as complete in database for runId: ${runId}`, dbErr.message);
      }
    }

    this.processes.delete(runId);
    if (onComplete) onComplete(exitCode);
    // Normalize to 1 on signal termination (signal info already logged above)
    return exitCode ?? 1;
  }

  /** Handle a run failure (process error or setup exception). Flushes output, marks failed, resolves. */
  #handleRunFailure({ entry: entryParam, runId, err, onError, resolve }) {
    const entry = entryParam;
    if (entry) {
      if (entry.finalized) return;
      entry.finalized = true;
      this.#clearFlushTimers(entry);
      this.#appendOutput(entry, entry.outputProcessor.flush());
      this.#flushOutputBuffer(entry, runId);
    }
    const msg = entry ? `Failed to execute command: ${err.message}` : `Error running command: ${err.message}`;
    console.error(`[commandRunner.run] Error for runId: ${runId}`, err);
    if (onError) onError(msg);
    if (commandRuns && typeof commandRuns.complete === 'function') {
      try { commandRuns.complete(runId, 1); } catch (dbErr) { console.warn(`[commandRunner.run] DB error for runId: ${runId}`, dbErr.message); }
    }
    this.processes.delete(runId);
    resolve(1);
  }

  /** Run a command and stream output via callback. Returns exit code. */
  async run(params, callbacks = {}, metadata = {}) {
    const { runId, command, workingDirectory } = params;
    const { onOutput, onComplete, onError, onStarted } = callbacks;
    const { sessionId, buttonId } = metadata;

    return new Promise((resolve) => {
      try {
        this.#createDatabaseRecord(runId, sessionId, buttonId);
        const wrappedCommand = wrapCommandForPlatform(command);

        const child = spawn('sh', ['-c', wrappedCommand], {
          cwd: workingDirectory,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          env: createCommandRunnerEnv(),
        });

        const entry = this.#createProcessEntry(child, sessionId, buttonId);
        entry.onOutput = (text) => {
          try { onOutput?.(text); } catch (err) { console.warn('[commandRunner.run] Output callback failed:', err.message); }
        };
        entry.onOutputChunk = (chunk) => {
          try { callbacks.onOutputChunk?.(chunk); } catch (err) { console.warn('[commandRunner.run] Output callback failed:', err.message); }
        };
        this.processes.set(runId, entry);
        // Do not announce the run until status lookups can observe it. Clients
        // refresh active runs in response to this event and would otherwise
        // race the process-map registration, clearing the running indicator.
        onStarted?.();

        entry.bufferFlushTimer = setInterval(() => this.#flushOutputBuffer(entry, runId), this.outputBufferFlushInterval);

        const handleData = (data) => {
          const text = entry.outputProcessor.process(data.toString());
          if (text) {
            this.#appendOutput(entry, text);
            if (entry.outputBytes >= this.outputBufferMaxBytes) this.#flushOutputBuffer(entry, runId);
          }
        };

        child.stdout.on('data', handleData);
        child.stderr.on('data', handleData);

        child.on('error', (err) => {
          this.#handleRunFailure({ entry, runId, err, onError, resolve });
        });

        child.on('close', (exitCode, signal) => {
          resolve(this.#handleProcessClose({ entry, runId, exitCode, signal }, onComplete));
        });
      } catch (err) {
        this.#handleRunFailure({ entry: null, runId, err, onError, resolve });
      }
    });
  }

  /** Kill a running process. Returns true if killed, false if not found. */
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
        if (!this.processes.has(runId)) return;
        console.log(`[commandRunner.kill] Process still running, sending SIGKILL to runId: ${runId}`);
        try { process.kill(-pid, 'SIGKILL'); } catch {
          try { entry.process.kill('SIGKILL'); } catch { /* already dead */ }
        }
      }, 1000);

      // The close event is the sole finalization path; it drains both buffers.

      return true;
    } catch (err) {
      console.error(`Error killing process ${runId}:`, err);
      return false;
    }
  }

  /** Terminate all active child processes (called during graceful shutdown). */
  shutdownAll() {
    const sendSignal = (sig) => {
      for (const [, entry] of this.processes) {
        try { process.kill(-entry.process.pid, sig); } catch {
          try { entry.process.kill(sig); } catch { /* already dead */ }
        }
      }
    };
    sendSignal('SIGTERM');
    setTimeout(() => sendSignal('SIGKILL'), 1000).unref();
  }

  /** Get all active runs as a new Map. */
  getActiveRuns() {
    return new Map(this.processes);
  }

  /** Check if a run is active. */
  isRunning(runId) {
    return this.processes.has(runId);
  }

  /** Get all running commands for a project with one batched session lookup. */
  getRunningByProjectId(projectId, getSessionsByIds) {
    const sessionIds = [...new Set([...this.processes.values()].map(entry => entry.sessionId))];
    const batchResult = getSessionsByIds(sessionIds);
    // Compatibility for callers outside this repository that still provide the
    // former single-id lookup. First-party paths always take the batched branch.
    const sessionRows = Array.isArray(batchResult)
      ? batchResult
      : sessionIds.map(sessionId => getSessionsByIds(sessionId)).filter(Boolean);
    const sessionsById = new Map(sessionRows.map(session => [session.id, session]));
    const results = [];
    for (const [runId, entry] of this.processes.entries()) {
      const session = sessionsById.get(entry.sessionId);
      if (session?.projectId === projectId) {
        results.push({
          id: runId,
          runId,
          buttonId: entry.buttonId,
          sessionId: entry.sessionId,
          status: 'running',
          output: '',
          exitCode: null,
          startedAt: entry.startTime,
        });
      }
    }
    return results;
  }

  /** Mark an orphaned run as error in the database. */
  #markOrphanedRunAsError(dbRun) {
    console.log(
      `[commandRunner.getRunsBySession] Orphaned run detected: ${dbRun.id}, marking as error`
    );
    if (typeof commandRuns.complete === 'function') {
      try {
        commandRuns.complete(dbRun.id, -1);
      } catch (updateErr) {
        console.warn(
          `[commandRunner.getRunsBySession] Failed to update orphaned run: ${updateErr.message}`
        );
      }
    }
  }

  /** Process a database run record and return a normalized run object. */
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
      output: '',
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
          output: '',
          exitCode: undefined,
          startedAt: entry.startTime,
        });
      }
    }

    // Add latest completed runs from database (one per button, no time limit)
    this.#appendDbRuns(runs, sessionId);

    return runs;
  }

  #appendDbRuns(runs, sessionId) {
    // commandRuns might not be available in test environments
    if (!commandRuns || typeof commandRuns.getLatestRunsForSession !== 'function') return;
    try {
      const dbRuns = commandRuns.getLatestRunsForSession(sessionId);
      for (const dbRun of dbRuns) {
        // Don't duplicate running processes
        const isRunningInMemory = runs.some((r) => r.runId === dbRun.id);
        if (isRunningInMemory) continue;
        runs.push(this.#processDbRun(dbRun));
      }
    } catch (err) {
      console.error(
        `[commandRunner.getRunsBySession] Error fetching database runs for sessionId: ${sessionId}`,
        err
      );
    }
  }
}

// Singleton instance
export const commandRunner = new CommandRunner();
