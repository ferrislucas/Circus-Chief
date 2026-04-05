import { api } from '../../composables/useApi.js';

/**
 * Work log and streaming-related actions for the sessions store.
 * Extracted to keep the main sessions.js under the max-lines limit.
 */
export const workLogActions = {
  // ==================== WORK LOG ACTIONS ====================

  async fetchWorkLogs(sessionId) {
    // Pre-fetch guard: skip if user navigated away
    if (this.viewedSessionId && this.viewedSessionId !== sessionId) return;

    this.error = null;
    try {
      const grouped = await api.getSessionWorkLogs(sessionId);

      // Post-fetch guard: discard if user navigated away during await
      if (this.viewedSessionId && this.viewedSessionId !== sessionId) return;

      const fetchedLogIds = new Set();
      for (const messageId of Object.keys(grouped)) {
        for (const log of grouped[messageId] || []) fetchedLogIds.add(log.id);
      }
      const existingUnassociated = this.workLogs['_unassociated'] || [];
      const newUnassociatedLogs = existingUnassociated.filter(log => !fetchedLogIds.has(log.id));
      const fetchedUnassociated = grouped['_unassociated'] || [];
      this.workLogs = { ...grouped, '_unassociated': [...fetchedUnassociated, ...newUnassociatedLogs] };
    } catch (err) {
      if (!this.viewedSessionId || this.viewedSessionId === sessionId) {
        this.error = err.message;
      }
    }
  },

  addWorkLog(log) {
    if (this.currentSession && log.sessionId && log.sessionId !== this.currentSession.id) return;
    const messageId = log.messageId || '_unassociated';
    const currentLogs = this.workLogs[messageId] || [];
    if (currentLogs.some(l => l.id === log.id)) return;
    this.workLogs = { ...this.workLogs, [messageId]: [...currentLogs, log] };
  },

  setWorkLogs(workLogs) { this.workLogs = workLogs; },

  clearWorkLogs() {
    this.workLogs = {};
    this.clearAllPartialThinking();
  },

  associateWorkLogs(messageId) {
    const unassociated = this.workLogs['_unassociated'] || [];
    if (unassociated.length > 0) {
      const currentLogs = this.workLogs[messageId] || [];
      const currentIds = new Set(currentLogs.map(l => l.id));
      const newLogs = unassociated.filter(l => !currentIds.has(l.id));
      this.workLogs = { ...this.workLogs, [messageId]: [...currentLogs, ...newLogs], '_unassociated': [] };
    }
  },

  // ==================== STREAMING ACTIONS ====================

  setPartialThinking(thinking, sessionId = null) {
    const id = sessionId || this.currentSession?.id;
    if (!id) return;
    this.partialThinkingBySession = { ...this.partialThinkingBySession, [id]: thinking };
  },

  clearPartialThinking(sessionId = null) {
    const id = sessionId || this.currentSession?.id;
    if (!id) return;
    this.partialThinkingBySession = { ...this.partialThinkingBySession, [id]: null };
  },

  clearAllPartialThinking() { this.partialThinkingBySession = {}; },

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

  clearPartialText() {
    this.partialText = '';
    this._pendingPartialText = null;
    if (this._partialThrottleTimer) { clearTimeout(this._partialThrottleTimer); this._partialThrottleTimer = null; }
  },

  // ==================== USAGE ACTIONS ====================

  updateRunningUsage(usage, conversationId = null) {
    this.runningUsage = { ...usage, conversationId };
  },

  finalizeUsage(usage, conversationId = null) {
    if (conversationId) {
      const index = this.conversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        this.conversations.splice(index, 1, {
          ...this.conversations[index],
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests, contextWindow: usage.contextWindow, model: usage.model,
        });
      }
    }
    if (this.currentSession) {
      this.currentSession = {
        ...this.currentSession,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        webSearchRequests: usage.webSearchRequests, contextWindow: usage.contextWindow,
      };
    }
    this.runningUsage = null;
  },

  updateConversationUsage(conversationId, usage) {
    const index = this.conversations.findIndex((c) => c.id === conversationId);
    if (index !== -1) {
      this.conversations.splice(index, 1, {
        ...this.conversations[index],
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        webSearchRequests: usage.webSearchRequests, contextWindow: usage.contextWindow, model: usage.model,
      });
    }
  },

  clearRunningUsage() {
    this.runningUsage = null;
    this.clearPartialThinking();
  },
};
