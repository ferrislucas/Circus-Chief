import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import {
  truncateOutput,
  buildRunEntry,
  appendOutput as appendOutputHelper,
  flushPendingOutput as flushPendingOutputHelper,
  processRunFromApi,
  buildCompletedRunUpdate,
  buildErrorRunUpdate,
} from './commandButtonsOutputBuffer.js';

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
    _lastAppendedText: {}, // runId -> { text, timestamp } for dedup of dual-channel WS broadcasts
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
    /**
     * Latest run for a button across ALL sessions, used by the admin
     * `CommandButtonsPanel` to show "Last Started / Last Ended" columns.
     * Returns null when the button has no runs in local state.
     */
    getLatestRunForButtonInProject: (state) => (buttonId) => {
      const runsForButton = Object.values(state.runs)
        .filter((r) => r.buttonId === buttonId)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
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
        for (const run of runs) {
          this.runs[run.runId] = processRunFromApi(run, sessionId, this.runs[run.runId]);
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
          if (this.runs[runId]?.status === 'running') {
            continue;
          }

          // Add or update the run
          this.runs[runId] = buildRunEntry(run, runId, this.runs[runId]);
        }
        return runs;
      } catch (err) {
        this.error = `Failed to fetch latest runs: ${err.message}`;
        console.error(this.error, err);
        return [];
      }
    },

    appendOutput(runId, text) {
      appendOutputHelper(this, runId, text);
    },

    flushPendingOutput(runId) {
      flushPendingOutputHelper(this, runId);
    },

    completeRun(runId, exitCode, output) {
      if (this.runs[runId]) {
        this.flushPendingOutput(runId);
        delete this._lastAppendedText[runId];
        this.$patch({ runs: { [runId]: buildCompletedRunUpdate(this.runs[runId], exitCode, output) } });
      }
    },

    errorRun(runId, message) {
      if (this.runs[runId]) {
        this.flushPendingOutput(runId);
        this.$patch({ runs: { [runId]: buildErrorRunUpdate(this.runs[runId], message) } });
      }
    },

    async fetchRunOutput(sessionId, runId) {
      const existing = this.runs[runId];
      if (!existing || existing.status === 'running') return; // Don't fetch for running commands (streaming via WS)
      if (existing.output && existing.output.length > 0) return; // Already have output, skip

      try {
        const run = await api.getCommandRun(sessionId, runId);
        if (run.output && this.runs[runId]) {
          const { output, truncated } = truncateOutput(run.output);
          this.runs[runId] = {
            ...this.runs[runId],
            output,
            outputTruncated: truncated,
          };
        }
      } catch (err) {
        console.warn(`[commandButtons] Failed to fetch output for run ${runId}:`, err.message);
      }
    },

    setOutputCollapsed(runId, isCollapsed) {
      this.collapsedStates[runId] = isCollapsed;
    },

    async deleteRun(sessionId, runId) {
      await api.deleteCommandRun(sessionId, runId);
      this.clearRun(runId);
    },

    async deleteAllRunsForButton(sessionId, buttonId) {
      await api.deleteAllRunsForButton(sessionId, buttonId);
      // Clear all runs for this button from local state
      for (const runId of Object.keys(this.runs)) {
        if (this.runs[runId].buttonId === buttonId && this.runs[runId].sessionId === sessionId) {
          this.clearRun(runId);
        }
      }
    },

    clearRun(runId) {
      // Clean up any pending timers/buffers
      if (this._flushTimers[runId]) {
        clearTimeout(this._flushTimers[runId]);
        delete this._flushTimers[runId];
      }
      delete this._outputBuffers[runId];
      delete this._lastAppendedText[runId];
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
      this._lastAppendedText = {};
      this.runs = {};
      this.collapsedStates = {};
    },
  },
});
