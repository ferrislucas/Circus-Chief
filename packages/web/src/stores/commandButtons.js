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
        const response = await api.runCommandButton(sessionId, buttonId);
        const runId = response.runId;
        this.runs[runId] = {
          runId,
          buttonId,
          status: 'running',
          output: '',
          exitCode: null,
        };
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
      try {
        const activeRuns = await api.getActiveRuns(sessionId);
        // Restore runs to state
        for (const run of activeRuns) {
          this.runs[run.runId] = {
            runId: run.runId,
            buttonId: run.buttonId,
            status: 'running',
            output: run.output,
            exitCode: null,
          };
        }
        return activeRuns;
      } catch (err) {
        console.error('Failed to fetch active runs:', err);
        return [];
      }
    },

    // Handle WebSocket messages
    appendOutput(runId, text) {
      if (this.runs[runId]) {
        this.runs[runId].output += text;
      }
    },

    completeRun(runId, exitCode, output) {
      if (this.runs[runId]) {
        this.runs[runId].exitCode = exitCode;

        // FIX: Only replace output if server has a more complete version
        // (longer output), otherwise keep the output we accumulated via
        // appendOutput calls. This prevents race conditions where the
        // completion message arrives before all streaming chunks.
        if (output && output.length > this.runs[runId].output.length) {
          this.runs[runId].output = output;
        }
        // Otherwise, keep the accumulated streamed output

        this.runs[runId].status = exitCode === 0 ? 'success' : 'error';
      }
    },

    errorRun(runId, message) {
      if (this.runs[runId]) {
        this.runs[runId].status = 'error';
        this.runs[runId].output += `\n[Error] ${message}`;
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
