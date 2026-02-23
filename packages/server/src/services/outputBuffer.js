import { commandRuns } from '../database.js';

/**
 * Manages output buffering for command runs.
 * Accumulates output text and periodically flushes it to the database
 * to reduce write frequency while keeping the database reasonably up-to-date.
 */
export class OutputBuffer {
  /**
   * @param {number} flushIntervalMs - How often to flush buffered output to the database (default 500ms)
   */
  constructor(flushIntervalMs = 500) {
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Create a flush function for a specific run entry.
   * The flush function writes any accumulated outputBuffer content to the database.
   *
   * @param {string} runId - The run identifier
   * @param {Object} entry - The process entry object (must have outputBuffer, lastDbWrite properties)
   * @param {string} [sessionId] - Optional session ID (flush only happens if sessionId and buttonId exist)
   * @param {string} [buttonId] - Optional button ID
   * @returns {Function} A flush function that persists buffered output to the database
   */
  createFlushFn(runId, entry, sessionId, buttonId) {
    return () => {
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
  }

  /**
   * Start a periodic flush timer for a process entry.
   *
   * @param {Object} entry - The process entry (timer handle stored on entry.bufferFlushTimer)
   * @param {Function} flushFn - The flush function to call periodically
   */
  startTimer(entry, flushFn) {
    entry.bufferFlushTimer = setInterval(flushFn, this.flushIntervalMs);
  }

  /**
   * Stop and clear the periodic flush timer for a process entry.
   *
   * @param {Object} entry - The process entry
   */
  clearTimer(entry) {
    if (entry.bufferFlushTimer) {
      clearInterval(entry.bufferFlushTimer);
      entry.bufferFlushTimer = null;
    }
  }

  /**
   * Append text to both the cumulative output and the pending output buffer on an entry.
   *
   * @param {Object} entry - The process entry
   * @param {string} text - The text to append
   */
  append(entry, text) {
    entry.output += text;
    entry.outputBuffer += text;
  }
}
