import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useCommandButtonsStore = defineStore('commandButtons', {
  state: () => ({
    buttons: [],
    runs: {}, // runId -> { runId, buttonId, status, output, exitCode }
    loading: false,
    error: null,
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
  },

  actions: {
    async fetchButtons(projectId) {
      this.loading = true;
      this.error = null;
      try {
        this.buttons = await api.getCommandButtons(projectId);
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
        // Generate runId locally - don't wait for API
        // Using timestamp + random to ensure uniqueness
        const runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Optimistic update: create run IMMEDIATELY
        // This disables the button instantly in the UI
        this.runs[runId] = {
          runId,
          buttonId,
          sessionId,
          status: 'running',
          output: '',
          exitCode: null,
          startedAt: Date.now(),
        };

        // Send API request in background (don't await from caller)
        // If it fails, we'll catch and update the run status to 'error'
        api.runCommandButton(sessionId, buttonId).catch((err) => {
          // API failed: mark run as error using $patch for reactivity
          if (this.runs[runId]) {
            this.$patch({
              runs: {
                [runId]: {
                  ...this.runs[runId],
                  status: 'error',
                  output: `[Error] Failed to start command: ${err.message}`,
                  exitCode: 1,
                },
              },
            });
          }
          this.error = err.message;
        });

        // Return runId immediately (synchronous)
        // This allows button to disable immediately without waiting for API
        return runId;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async killRun(sessionId, runId) {
      this.error = null;
      try {
        await api.killCommandRun(sessionId, runId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async fetchActiveRuns(sessionId) {
      this.error = null;
      try {
        const runs = await api.getActiveRuns(sessionId);
        // Restore runs to state (both running and recently completed)
        for (const run of runs) {
          this.runs[run.runId] = {
            runId: run.runId,
            buttonId: run.buttonId,
            sessionId: sessionId,
            status: run.status || 'running',
            output: run.output || '',
            exitCode: run.exitCode !== undefined ? run.exitCode : null,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          };
        }
        return runs;
      } catch (err) {
        this.error = `Failed to fetch active runs: ${err.message}`;
        console.error(this.error, err);
        return [];
      }
    },

    // Handle WebSocket messages
    appendOutput(runId, text) {
      if (this.runs[runId]) {
        // Use $patch to ensure reactivity
        this.$patch({
          runs: {
            [runId]: {
              ...this.runs[runId],
              output: this.runs[runId].output + text,
            },
          },
        });
      }
    },

    completeRun(runId, exitCode, output) {
      if (this.runs[runId]) {
        // Use $patch to ensure reactivity
        // FIX: Only replace output if server has a more complete version
        // (longer output), otherwise keep the output we accumulated via
        // appendOutput calls. This prevents race conditions where the
        // completion message arrives before all streaming chunks.
        const newOutput =
          output && output.length > this.runs[runId].output.length
            ? output
            : this.runs[runId].output;

        this.$patch({
          runs: {
            [runId]: {
              ...this.runs[runId],
              exitCode: exitCode,
              completedAt: Date.now(),
              output: newOutput,
              status: exitCode === 0 ? 'success' : 'error',
            },
          },
        });
      }
    },

    errorRun(runId, message) {
      if (this.runs[runId]) {
        // Use $patch to ensure reactivity
        this.$patch({
          runs: {
            [runId]: {
              ...this.runs[runId],
              status: 'error',
              output: this.runs[runId].output + `\n[Error] ${message}`,
            },
          },
        });
      }
    },

    clearRun(runId) {
      delete this.runs[runId];
    },

    clearAllRuns() {
      this.runs = {};
    },
  },
});
