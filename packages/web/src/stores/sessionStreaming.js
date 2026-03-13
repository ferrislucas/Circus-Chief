import { defineStore } from 'pinia';

export const useSessionStreamingStore = defineStore('sessionStreaming', {
  state: () => ({
    partialText: '',
    partialThinkingBySession: {},
    _partialThrottleTimer: null,
    _pendingPartialText: null,
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
     * Set partial thinking content for streaming display (per-session)
     * @param {string} thinking - The thinking content
     * @param {string} sessionId - Session ID
     */
    setPartialThinking(thinking, sessionId) {
      if (!sessionId) return;
      this.partialThinkingBySession = {
        ...this.partialThinkingBySession,
        [sessionId]: thinking,
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
  },
});
