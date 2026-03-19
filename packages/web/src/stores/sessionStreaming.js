import { defineStore } from 'pinia';

export const useSessionStreamingStore = defineStore('sessionStreaming', {
  state: () => ({
    partialText: '',
    partialThinkingBySession: {},
    _partialThrottleTimer: null,
    _pendingPartialText: null,

    // Per-session streaming state for list view
    sessionWorkLogs: {},           // { [sessionId]: workLogEntry[] }
    sessionPartialText: {},        // { [sessionId]: string }
    sessionFileCounts: {},         // { [sessionId]: number }

    // UI preference: which sessions have logs collapsed
    collapsedSessionLogs: new Set(),  // sessionIds where user closed the log panel
  }),

  getters: {
    /**
     * Get partial thinking for the given session ID
     * @param {string} sessionId - Session ID to get thinking for
     * @returns {string|null}
     */
    getPartialThinking: (state) => (sessionId) => {
      if (!sessionId) return null;
      return state.partialThinkingBySession[sessionId] || null;
    },

    /**
     * Get work logs for a session (list view)
     * @param {string} sessionId
     * @returns {Array}
     */
    getSessionWorkLogs: (state) => (sessionId) => {
      return state.sessionWorkLogs[sessionId] || [];
    },

    /**
     * Get partial text for a session (list view)
     * @param {string} sessionId
     * @returns {string}
     */
    getSessionPartialText: (state) => (sessionId) => {
      return state.sessionPartialText[sessionId] || '';
    },

    /**
     * Get the file change count for a session
     * @param {string} sessionId
     * @returns {number}
     */
    getSessionFileCount: (state) => (sessionId) => {
      return state.sessionFileCounts[sessionId] || 0;
    },

    /**
     * Check if a session's log panel is collapsed
     * @param {string} sessionId
     * @returns {boolean}
     */
    isSessionLogCollapsed: (state) => (sessionId) => {
      return state.collapsedSessionLogs.has(sessionId);
    },
  },

  actions: {
    /**
     * Set partial text with throttling to reduce CPU load on iPad
     * @param {string} text - The streaming partial text
     */
    setPartialText(text) {
      const PARTIAL_THROTTLE_MS = 150;
      this._pendingPartialText = text;

      if (!this._partialThrottleTimer) {
        this.partialText = text;

        this._partialThrottleTimer = setTimeout(() => {
          if (this._pendingPartialText !== null && this._pendingPartialText !== this.partialText) {
            this.partialText = this._pendingPartialText;
          }
          this._partialThrottleTimer = null;
          this._pendingPartialText = null;
        }, PARTIAL_THROTTLE_MS);
      }
    },

    /**
     * Clear partial text and reset throttle state
     */
    clearPartialText() {
      this.partialText = '';
      this._pendingPartialText = null;
      if (this._partialThrottleTimer) {
        clearTimeout(this._partialThrottleTimer);
        this._partialThrottleTimer = null;
      }
    },

    /**
     * Set partial thinking content for streaming display (per-session).
     * Empty/null/falsy values clear the thinking (set to null).
     * @param {string} thinking - The thinking content
     * @param {string} sessionId - Session ID
     */
    setPartialThinking(thinking, sessionId) {
      if (!sessionId) return;
      this.partialThinkingBySession = {
        ...this.partialThinkingBySession,
        [sessionId]: thinking || null,
      };
    },

    /**
     * Clear partial thinking when complete (per-session)
     * @param {string} sessionId - Session ID
     */
    clearPartialThinking(sessionId) {
      if (!sessionId) return;
      this.partialThinkingBySession = {
        ...this.partialThinkingBySession,
        [sessionId]: null,
      };
    },

    /**
     * Clear all partial thinking (for cleanup)
     */
    clearAllPartialThinking() {
      this.partialThinkingBySession = {};
    },

    /**
     * Add a work log entry for a session (list view, capped at 15 entries)
     * @param {string} sessionId
     * @param {Object} log - The work log entry
     */
    addSessionWorkLog(sessionId, log) {
      if (!this.sessionWorkLogs[sessionId]) {
        this.sessionWorkLogs[sessionId] = [];
      }
      this.sessionWorkLogs[sessionId].push(log);
      // Keep only last 15 entries
      if (this.sessionWorkLogs[sessionId].length > 15) {
        this.sessionWorkLogs[sessionId] = this.sessionWorkLogs[sessionId].slice(-15);
      }
      // Trigger reactivity
      this.sessionWorkLogs = { ...this.sessionWorkLogs };
    },

    /**
     * Set partial text for a session (list view).
     * Empty/null/falsy values clear the text (set to '').
     * @param {string} sessionId
     * @param {string} text
     */
    setSessionPartialText(sessionId, text) {
      this.sessionPartialText = {
        ...this.sessionPartialText,
        [sessionId]: text || '',
      };
    },

    /**
     * Set the file change count for a session
     * @param {string} sessionId
     * @param {number} count
     */
    setSessionFileCount(sessionId, count) {
      this.sessionFileCounts = {
        ...this.sessionFileCounts,
        [sessionId]: count,
      };
    },

    /**
     * Hydrate streaming state from a REST snapshot (used when subscribing to a running session).
     * Only populates if the store doesn't already have data for that session,
     * to avoid overwriting more recent WebSocket data.
     * @param {string} sessionId
     * @param {{ workLogs?: Array, partialText?: string, thinking?: string|null }} snapshot
     */
    hydrateSessionState(sessionId, { workLogs, partialText, thinking } = {}) {
      if (!this.sessionWorkLogs[sessionId]?.length) {
        if (workLogs?.length) {
          this.sessionWorkLogs = { ...this.sessionWorkLogs, [sessionId]: workLogs };
        }
      }
      if (!this.sessionPartialText[sessionId]) {
        if (partialText) {
          this.sessionPartialText = { ...this.sessionPartialText, [sessionId]: partialText };
        }
      }
      if (!this.partialThinkingBySession[sessionId]) {
        if (thinking) {
          this.partialThinkingBySession = { ...this.partialThinkingBySession, [sessionId]: thinking };
        }
      }
    },

    /**
     * Clear all streaming state for a session (list view)
     * @param {string} sessionId
     */
    clearSessionStreamingState(sessionId) {
      const { [sessionId]: _wl, ...restWorkLogs } = this.sessionWorkLogs;
      this.sessionWorkLogs = restWorkLogs;

      const { [sessionId]: _pt, ...restPartialText } = this.sessionPartialText;
      this.sessionPartialText = restPartialText;

      const { [sessionId]: _th, ...restThinking } = this.partialThinkingBySession;
      this.partialThinkingBySession = restThinking;

      const { [sessionId]: _fc, ...restFileCounts } = this.sessionFileCounts;
      this.sessionFileCounts = restFileCounts;
    },

    /**
     * Toggle collapsed state for a session's log panel
     * @param {string} sessionId
     */
    toggleSessionLogCollapsed(sessionId) {
      if (this.collapsedSessionLogs.has(sessionId)) {
        this.collapsedSessionLogs.delete(sessionId);
      } else {
        this.collapsedSessionLogs.add(sessionId);
      }
      // Trigger reactivity by creating new Set
      this.collapsedSessionLogs = new Set(this.collapsedSessionLogs);
      this.saveCollapsedLogState();
    },

    /**
     * Save collapsed log state to localStorage
     */
    saveCollapsedLogState() {
      try {
        localStorage.setItem('collapsedSessionLogs', JSON.stringify([...this.collapsedSessionLogs]));
      } catch (e) { /* ignore */ }
    },

    /**
     * Restore collapsed log state from localStorage
     */
    restoreCollapsedLogState() {
      try {
        const saved = localStorage.getItem('collapsedSessionLogs');
        if (saved) this.collapsedSessionLogs = new Set(JSON.parse(saved));
      } catch (e) { /* ignore */ }
    },
  },
});
