import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

// Performance: Limit output to prevent memory bloat and UI slowdown
const MAX_OUTPUT_LINES = 2000;
// Increased from 100ms to 300ms to reduce reactive updates while remaining responsive
const OUTPUT_FLUSH_INTERVAL_MS = 300;

export const useCommandButtonsStore = defineStore('commandButtons', {
  state: () => ({
    buttons: [],
    runs: {}, // runId -> { runId, buttonId, status, output, exitCode, outputTruncated }
    collapsedStates: {}, // runId -> boolean (true = collapsed, false = expanded)
    loading: false,
    error: null,
    // Internal buffering state (not reactive to avoid extra renders)
    _outputBuffers: {}, // runId -> pending output string
    _flushTimers: {}, // runId -> setTimeout id
  }),

  getters: {
    getButtonById: (state) => (buttonId) => state.buttons.find((b) => b.id === buttonId),
    getRun: (state) => (runId) => state.runs[runId],
    activeRuns: (state) => Object.values(state.runs).filter((r) => r.status === 'running'),
    getButtonsByProjectId: (state) => (projectId) => state.buttons.filter((b) => b.projectId === projectId),
    getLatestRunForButton: (state) => (buttonId, sessionId) => {
      // Find all runs for this button in this session, sorted by startedAt descending
      const runsForButton = Object.values(state.runs)
        .filter((r) => r.buttonId === buttonId && r.sessionId === sessionId)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

      // Return the first one (most recent)
      return runsForButton.length > 0 ? runsForButton[0] : null;
    },
    isOutputCollapsed: (state) => (runId) => {
      // If user has set a preference, use it
      if (state.collapsedStates[runId] !== undefined) {
        return state.collapsedStates[runId];
      }
      // Otherwise, default to collapsed (output pane stays collapsed by default)
      return true;
    },
  },

  actions: {
    async fetchButtons(projectId) {
      this.loading = true;
      this.error = null;
      try {
        const newButtons = await api.getCommandButtons(projectId);

        // Remove old buttons for this project to avoid duplicates
        this.buttons = this.buttons.filter(b => b.projectId !== projectId);

        // Add new buttons
        this.buttons.push(...newButtons);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async createButton(projectId, data) {
      this.error = null;
      try {
        const button = await api.createCommandButton(projectId, data);
        this.buttons.push(button);
        return button;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async updateButton(projectId, buttonId, data) {
      this.error = null;
      try {
        const updated = await api.updateCommandButton(projectId, buttonId, data);
        const index = this.buttons.findIndex((b) => b.id === buttonId);
        if (index >= 0) {
          this.buttons[index] = updated;
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async deleteButton(projectId, buttonId) {
      this.error = null;
      try {
        await api.deleteCommandButton(projectId, buttonId);
        this.buttons = this.buttons.filter((b) => b.id !== buttonId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async runButton(sessionId, buttonId) {
      this.error = null;
      try {
        // Wait for API response to get server-generated runId
        // This ensures WebSocket messages (which use server's runId) can find the run
        const response = await api.runCommandButton(sessionId, buttonId);
        const runId = response.runId;

        // Create run with server's runId so WebSocket updates work
        this.runs[runId] = {
          runId,
          buttonId,
          sessionId,
          status: 'running',
          output: response.output || '',
          exitCode: null,
          startedAt: Date.now(),
          outputTruncated: false,
        };

        return runId;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async killRun(sessionId, runId) {
      // Note: Don't set this.error for kill failures - the component
      // already handles this via toast. Setting error would hide the command list.
      try {
        await api.killCommandRun(sessionId, runId);
      } catch (err) {
        // If the process is already dead (or we can't find it), update the
        // run status so the UI shows the Run button instead of being stuck
        // on the Kill button
        if (this.runs[runId] && this.runs[runId].status === 'running') {
          // Use direct state mutation for reliability instead of $patch
          this.runs[runId] = {
            ...this.runs[runId],
            status: 'error',
            exitCode: -1, // Indicate abnormal termination
            completedAt: Date.now(),
          };
          // State is recovered - don't throw since UI is now correct
          // The component will still show a toast via the catch block
          // but we need to let it know this was a "soft" error
          console.log(`[killRun] Process ${runId} not found on server, updated UI state to error`);
          return;
        }
        // Only throw if we couldn't recover the state
        throw err;
      }
    },

    async fetchActiveRuns(sessionId) {
      this.error = null;
      try {
        const runs = await api.getActiveRuns(sessionId);
        // Restore runs to state (both running and recently completed)
        for (const run of runs) {
          const { output, truncated } = this._truncateOutput(run.output || '');
          this.runs[run.runId] = {
            runId: run.runId,
            buttonId: run.buttonId,
            sessionId: sessionId,
            status: run.status || 'running',
            output,
            exitCode: run.exitCode !== undefined ? run.exitCode : null,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            outputTruncated: truncated,
          };
        }
        return runs;
      } catch (err) {
        this.error = `Failed to fetch active runs: ${err.message}`;
        console.error(this.error, err);
        return [];
      }
    },

    async fetchLatestRunsForProject(projectId) {
      this.error = null;
      try {
        const runs = await api.getLatestRunsForProject(projectId);
        // Populate state with historical run data
        // Preserve any already-running commands (don't overwrite with stale data)
        for (const run of runs) {
          const runId = run.id || run.runId;

          // Skip if we already have a running command with this ID
          // (keep the version with accumulated output)
          if (this.runs[runId] && this.runs[runId].status === 'running') {
            continue;
          }

          // Add or update the run
          const { output, truncated } = this._truncateOutput(run.output || '');
          this.runs[runId] = {
            runId,
            buttonId: run.buttonId,
            sessionId: run.sessionId,
            status: run.status || 'running',
            output,
            exitCode: run.exitCode !== undefined ? run.exitCode : null,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            outputTruncated: truncated,
          };
        }
        return runs;
      } catch (err) {
        this.error = `Failed to fetch latest runs: ${err.message}`;
        console.error(this.error, err);
        return [];
      }
    },

    /**
     * Truncate output to MAX_OUTPUT_LINES, keeping only the most recent lines.
     * Returns { output: string, truncated: boolean }
     */
    _truncateOutput(text) {
      const lines = text.split('\n');
      if (lines.length <= MAX_OUTPUT_LINES) {
        return { output: text, truncated: false };
      }
      // Keep only the last MAX_OUTPUT_LINES
      const truncatedLines = lines.slice(-MAX_OUTPUT_LINES);
      return { output: truncatedLines.join('\n'), truncated: true };
    },

    /**
     * Flush buffered output to the run state.
     * Called on a timer to batch updates and reduce reactivity overhead.
     */
    _flushOutput(runId) {
      const buffer = this._outputBuffers[runId];
      if (!buffer || !this.runs[runId]) {
        delete this._outputBuffers[runId];
        delete this._flushTimers[runId];
        return;
      }

      // Combine existing output with buffer
      const combined = this.runs[runId].output + buffer;
      const { output, truncated } = this._truncateOutput(combined);

      // Update state in one batch
      this.$patch({
        runs: {
          [runId]: {
            ...this.runs[runId],
            output,
            outputTruncated: this.runs[runId].outputTruncated || truncated,
          },
        },
      });

      // Clear the buffer
      delete this._outputBuffers[runId];
      delete this._flushTimers[runId];
    },

    /**
     * Handle WebSocket output messages with throttling.
     * Buffers output and flushes every OUTPUT_FLUSH_INTERVAL_MS to prevent
     * excessive re-renders when output is streaming rapidly.
     */
    appendOutput(runId, text) {
      if (!this.runs[runId]) {
        return;
      }

      // Append to buffer
      this._outputBuffers[runId] = (this._outputBuffers[runId] || '') + text;

      // Schedule flush if not already scheduled
      if (!this._flushTimers[runId]) {
        this._flushTimers[runId] = setTimeout(() => {
          this._flushOutput(runId);
        }, OUTPUT_FLUSH_INTERVAL_MS);
      }
    },

    /**
     * Force flush any pending output immediately.
     * Called before completing a run to ensure all output is displayed.
     */
    flushPendingOutput(runId) {
      if (this._flushTimers[runId]) {
        clearTimeout(this._flushTimers[runId]);
        delete this._flushTimers[runId];
      }
      if (this._outputBuffers[runId]) {
        this._flushOutput(runId);
      }
    },

    completeRun(runId, exitCode, output) {
      if (this.runs[runId]) {
        // Flush any pending buffered output first
        this.flushPendingOutput(runId);

        // FIX: Only replace output if server has a more complete version
        // (longer output), otherwise keep the output we accumulated via
        // appendOutput calls. This prevents race conditions where the
        // completion message arrives before all streaming chunks.
        let newOutput = this.runs[runId].output;
        let truncated = this.runs[runId].outputTruncated;

        if (output && output.length > this.runs[runId].output.length) {
          const result = this._truncateOutput(output);
          newOutput = result.output;
          truncated = result.truncated;
        }

        this.$patch({
          runs: {
            [runId]: {
              ...this.runs[runId],
              exitCode: exitCode,
              completedAt: Date.now(),
              output: newOutput,
              outputTruncated: truncated,
              status: exitCode === 0 ? 'success' : 'error',
            },
          },
        });
      }
    },

    errorRun(runId, message) {
      if (this.runs[runId]) {
        // Flush any pending buffered output first
        this.flushPendingOutput(runId);

        const combined = this.runs[runId].output + `\n[Error] ${message}`;
        const { output, truncated } = this._truncateOutput(combined);

        this.$patch({
          runs: {
            [runId]: {
              ...this.runs[runId],
              status: 'error',
              output,
              outputTruncated: this.runs[runId].outputTruncated || truncated,
            },
          },
        });
      }
    },

    setOutputCollapsed(runId, isCollapsed) {
      this.collapsedStates[runId] = isCollapsed;
    },

    clearRun(runId) {
      // Clean up any pending timers/buffers
      if (this._flushTimers[runId]) {
        clearTimeout(this._flushTimers[runId]);
        delete this._flushTimers[runId];
      }
      delete this._outputBuffers[runId];
      delete this.runs[runId];
      delete this.collapsedStates[runId];
    },

    clearAllRuns() {
      // Clean up all pending timers
      for (const runId of Object.keys(this._flushTimers)) {
        clearTimeout(this._flushTimers[runId]);
      }
      this._flushTimers = {};
      this._outputBuffers = {};
      this.runs = {};
      this.collapsedStates = {};
    },
  },
});
