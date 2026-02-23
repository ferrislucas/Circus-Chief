import { commandRuns } from '../database.js';

/**
 * Registry for tracking active command processes and querying their state.
 * Manages the in-memory Map of running processes and provides query methods
 * that combine in-memory state with database records.
 */
export class ProcessRegistry {
  constructor() {
    /** @type {Map<string, Object>} runId -> { process, startTime, sessionId, buttonId, output, outputBuffer, lastDbWrite, bufferFlushTimer, outputProcessor } */
    this.processes = new Map();
  }

  /**
   * Register a process entry
   * @param {string} runId
   * @param {Object} entry
   */
  set(runId, entry) {
    this.processes.set(runId, entry);
  }

  /**
   * Get a process entry
   * @param {string} runId
   * @returns {Object|undefined}
   */
  get(runId) {
    return this.processes.get(runId);
  }

  /**
   * Check if a process entry exists
   * @param {string} runId
   * @returns {boolean}
   */
  has(runId) {
    return this.processes.has(runId);
  }

  /**
   * Remove a process entry
   * @param {string} runId
   * @returns {boolean}
   */
  delete(runId) {
    return this.processes.delete(runId);
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
            // FIX: If DB shows "running" but we don't have the process in memory,
            // it's an orphaned run (server restarted, process died unexpectedly, etc.)
            // Mark it as error in the database so the UI shows the correct state
            let status = dbRun.status;
            let exitCode = dbRun.exitCode;

            if (dbRun.status === 'running' && !this.processes.has(dbRun.id)) {
              console.log(
                `[commandRunner.getRunsBySession] Orphaned run detected: ${dbRun.id}, marking as error`
              );
              status = 'error';
              exitCode = -1;

              // Update the database to reflect the actual state
              if (typeof commandRuns.complete === 'function') {
                try {
                  commandRuns.complete(dbRun.id, exitCode, dbRun.output || '');
                } catch (updateErr) {
                  console.warn(
                    `[commandRunner.getRunsBySession] Failed to update orphaned run: ${updateErr.message}`
                  );
                }
              }
            }

            runs.push({
              runId: dbRun.id,
              buttonId: dbRun.buttonId,
              status,
              output: dbRun.output,
              exitCode,
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
