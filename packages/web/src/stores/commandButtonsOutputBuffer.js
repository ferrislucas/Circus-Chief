// Performance: Limit output to prevent memory bloat and UI slowdown
export const MAX_OUTPUT_LINES = 2000;
// Increased from 100ms to 300ms to reduce reactive updates while remaining responsive
export const OUTPUT_FLUSH_INTERVAL_MS = 300;

/**
 * Truncate output to MAX_OUTPUT_LINES, keeping only the most recent lines.
 * Returns { output: string, truncated: boolean }
 * @param {string} text - The text to truncate
 * @returns {{ output: string, truncated: boolean }}
 */
export function truncateOutput(text) {
  const lines = text.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) {
    return { output: text, truncated: false };
  }
  // Keep only the last MAX_OUTPUT_LINES
  const truncatedLines = lines.slice(-MAX_OUTPUT_LINES);
  return { output: truncatedLines.join('\n'), truncated: true };
}

/**
 * Build a run entry, preserving existing output if API returned empty.
 * @param {Object} run - The run data from API
 * @param {string} runId - The resolved run ID
 * @param {Object|undefined} existing - Existing run entry if present
 * @returns {Object} The run entry to store
 */
export function buildRunEntry(run, runId, existing) {
  const { output, truncated } = truncateOutput(run.output || '');
  // Preserve existing output if API returned empty (lightweight queries exclude output)
  const hasExistingOutput = !output && existing?.output;
  return {
    runId,
    buttonId: run.buttonId,
    sessionId: run.sessionId,
    status: run.status || 'running',
    output: hasExistingOutput ? existing.output : output,
    exitCode: run.exitCode ?? null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    outputTruncated: hasExistingOutput ? existing.outputTruncated : truncated,
  };
}

/**
 * Flush buffered output to the run state.
 * Called on a timer to batch updates and reduce reactivity overhead.
 * @param {Object} store - The Pinia store instance (with runs, _outputBuffers, _flushTimers, $patch)
 * @param {string} runId - The run ID to flush
 */
export function flushOutput(store, runId) {
  const buffer = store._outputBuffers[runId];
  if (!buffer || !store.runs[runId]) {
    delete store._outputBuffers[runId];
    delete store._flushTimers[runId];
    return;
  }

  // Don't flush output for completed runs - output is already finalized
  // This prevents duplication if a flush timer fires after completeRun
  if (store.runs[runId].status !== 'running') {
    delete store._outputBuffers[runId];
    delete store._flushTimers[runId];
    return;
  }

  // Combine existing output with buffer
  const combined = store.runs[runId].output + buffer;
  const { output, truncated } = truncateOutput(combined);

  // Update state in one batch
  store.$patch({
    runs: {
      [runId]: {
        ...store.runs[runId],
        output,
        outputTruncated: store.runs[runId].outputTruncated || truncated,
      },
    },
  });

  // Clear the buffer
  delete store._outputBuffers[runId];
  delete store._flushTimers[runId];
}

/**
 * Handle WebSocket output messages with throttling.
 * Buffers output and flushes every OUTPUT_FLUSH_INTERVAL_MS to prevent
 * excessive re-renders when output is streaming rapidly.
 * @param {Object} store - The Pinia store instance
 * @param {string} runId - The run ID
 * @param {string} text - The text to append
 */
export function appendOutput(store, runId, text) {
  if (!store.runs[runId]) {
    return;
  }

  // Ignore output for completed runs to prevent duplication
  // (WS output events can arrive after the complete event due to race conditions)
  if (store.runs[runId].status !== 'running') {
    return;
  }

  // Deduplicate identical output messages arriving from dual-channel WS broadcasts
  // (server broadcasts to both session and project channels, client may receive both)
  const now = Date.now();
  const lastAppend = store._lastAppendedText[runId];
  if (lastAppend && lastAppend.text === text && (now - lastAppend.timestamp) < 100) {
    return; // Skip duplicate
  }
  store._lastAppendedText[runId] = { text, timestamp: now };

  // Append to buffer
  store._outputBuffers[runId] = (store._outputBuffers[runId] || '') + text;

  // Schedule flush if not already scheduled
  if (!store._flushTimers[runId]) {
    store._flushTimers[runId] = setTimeout(() => {
      flushOutput(store, runId);
    }, OUTPUT_FLUSH_INTERVAL_MS);
  }
}

/**
 * Force flush any pending output immediately.
 * Called before completing a run to ensure all output is displayed.
 * @param {Object} store - The Pinia store instance
 * @param {string} runId - The run ID to flush
 */
export function flushPendingOutput(store, runId) {
  if (store._flushTimers[runId]) {
    clearTimeout(store._flushTimers[runId]);
    delete store._flushTimers[runId];
  }
  if (store._outputBuffers[runId]) {
    flushOutput(store, runId);
  }
}

/**
 * Process a run object from API and build a run entry for state.
 * Preserves existing output if API returned empty (lightweight queries exclude output).
 * @param {Object} run - The run data from API
 * @param {string} sessionId - The session ID
 * @param {Object|undefined} existing - Existing run entry if present
 * @returns {Object} The run entry to store
 */
export function processRunFromApi(run, sessionId, existing) {
  const { output, truncated } = truncateOutput(run.output || '');
  const resolvedOutput = (!output && existing?.output) ? existing.output : output;
  const resolvedTruncated = (!output && existing?.output) ? existing.outputTruncated : truncated;

  return {
    runId: run.runId,
    buttonId: run.buttonId,
    sessionId,
    status: run.status || 'running',
    output: resolvedOutput,
    exitCode: run.exitCode !== undefined ? run.exitCode : null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    outputTruncated: resolvedTruncated,
  };
}

/**
 * Build a completed run state update object.
 * @param {Object} currentRun - The current run state
 * @param {number} exitCode - The exit code
 * @param {string|undefined} output - Optional output from server
 * @returns {Object} The run update object for $patch
 */
export function buildCompletedRunUpdate(currentRun, exitCode, output) {
  let newOutput = currentRun.output;
  let truncated = currentRun.outputTruncated;

  if (output && output.length > currentRun.output.length) {
    const result = truncateOutput(output);
    newOutput = result.output;
    truncated = result.truncated;
  }

  return {
    ...currentRun,
    exitCode,
    completedAt: Date.now(),
    output: newOutput,
    outputTruncated: truncated,
    status: exitCode === 0 ? 'success' : 'error',
  };
}

/**
 * Build an error run state update object.
 * @param {Object} currentRun - The current run state
 * @param {string} message - The error message
 * @returns {Object} The run update object for $patch
 */
export function buildErrorRunUpdate(currentRun, message) {
  const combined = `${currentRun.output}\n[Error] ${message}`;
  const { output, truncated } = truncateOutput(combined);

  return {
    ...currentRun,
    status: 'error',
    output,
    outputTruncated: currentRun.outputTruncated || truncated,
  };
}
