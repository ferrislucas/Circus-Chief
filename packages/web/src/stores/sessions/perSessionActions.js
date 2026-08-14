import { api } from '../../composables/useApi.js';

/**
 * TTL, in milliseconds, after which a `recentSends[sessionId]` marker is
 * considered expired. Used by both the `hasRecentSend` getter and the
 * safety-net `setTimeout` in `markRecentSend`. Extracted here so the value
 * is defined in exactly one place.
 */
export const RECENT_SEND_TTL_MS = 5000;

/**
 * Per-session actions shared between the main sessions store and overlay stores.
 * These operate on the store's own local state (messages, workLogs, partialText, etc.)
 * and are spread directly into the Pinia store actions, so `this` refers to the store instance.
 *
 * NOTE: fetchSession is intentionally NOT included here — the main store and overlay
 * store have fundamentally different implementations (the main store walks the parent
 * chain and fetches child sessions from the project).
 */
export const perSessionActions = {
  // ==================== MESSAGE ACTIONS ====================

  /**
   * Check if this store is viewing a different session (stale guard).
   */
  _isStaleSession(sessionId) {
    return this.viewedSessionId && this.viewedSessionId !== sessionId;
  },

  /**
   * Check if this store is actively viewing the given session.
   * Returns false when viewedSessionId is null (no session viewed).
   */
  _isActiveSession(sessionId) {
    return this.viewedSessionId && this.viewedSessionId === sessionId;
  },

  async fetchMessages(sessionId, showLoading = true, conversationId = null) {
    if (this._isStaleSession(sessionId)) return;

    if (showLoading) this.loading = true;
    this.error = null;
    try {
      const cid = conversationId || this.activeConversationId;
      const fetchedMessages = cid
        ? await api.getConversationMessages(sessionId, cid)
        : await api.getSessionMessages(sessionId);

      if (this._isStaleSession(sessionId)) return;

      const fetchedIds = new Set(fetchedMessages.map(m => m.id));
      const newMessages = this.messages.filter(m => m.sessionId === sessionId && !fetchedIds.has(m.id));
      if (newMessages.length > 0) {
        this.messages = [...fetchedMessages, ...newMessages];
      } else {
        this.messages = fetchedMessages;
      }
    } catch (err) {
      if (this._isActiveSession(sessionId)) {
        this.error = err.message;
      }
    } finally {
      if (showLoading) this.loading = false;
    }
  },

  addMessage(message) {
    // Bump list ordering for ALL inbound messages so background sessions re-sort
    // live in the project session list, not only the currently-open session.
    this._bumpActivityTimestamps(message);
    if (this.currentSession && message.sessionId && message.sessionId !== this.currentSession.id) return;
    if (!this.messages.some(m => m.id === message.id)) this.messages.push(message);
  },

  /**
   * Bump conversation-derived timestamps on the session lists so session views
   * re-sort and re-render as new conversation turns arrive. Never moves either
   * value backwards.
   */
  _bumpActivityTimestamps(message) {
    if (!message?.sessionId) return;
    if (typeof this._updateSessionInAllLists !== 'function') return;
    const ts = message.timestamp ?? Date.now();
    const existing = this._findSessionById ? this._findSessionById(message.sessionId) : null;
    const updates = {};

    const currentLastActivityAt = existing?.lastActivityAt ?? 0;
    if (!currentLastActivityAt || ts > currentLastActivityAt) updates.lastActivityAt = ts;

    const currentLastMessageAt = existing?.lastMessageAt ?? 0;
    if (!currentLastMessageAt || ts > currentLastMessageAt) updates.lastMessageAt = ts;

    if (Object.keys(updates).length > 0) this._updateSessionInAllLists(message.sessionId, updates);
  },

  // ==================== WORK LOG ACTIONS ====================

  async fetchWorkLogs(sessionId) {
    if (this._isStaleSession(sessionId)) return;
    this.error = null;
    try {
      const grouped = await api.getSessionWorkLogs(sessionId);
      if (this._isStaleSession(sessionId)) return;

      const fetchedLogIds = new Set();
      for (const messageId of Object.keys(grouped)) {
        for (const log of grouped[messageId] || []) fetchedLogIds.add(log.id);
      }
      const existingUnassociated = this.workLogs['_unassociated'] || [];
      const newUnassociatedLogs = existingUnassociated.filter(log => !fetchedLogIds.has(log.id));
      const fetchedUnassociated = grouped['_unassociated'] || [];
      this.workLogs = { ...grouped, '_unassociated': [...fetchedUnassociated, ...newUnassociatedLogs] };
    } catch (err) {
      if (this._isActiveSession(sessionId)) {
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
    if (this._partialThrottleTimer) {
      clearTimeout(this._partialThrottleTimer);
      this._partialThrottleTimer = null;
    }
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
          thinkingTokens: usage.thinkingTokens,
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
        thinkingTokens: usage.thinkingTokens,
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
        thinkingTokens: usage.thinkingTokens,
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

  // ==================== RECENT-SEND MARKER ACTIONS ====================
  //
  // Per-session, in-memory marker set when the user issues a Send/Start,
  // used to suppress the ConversationTab onMounted restore that would
  // otherwise re-populate the textarea with the just-sent prompt on remount.
  //
  // Scoped to each store instance so the overlay (which uses its own store
  // factory) and the main view don't cross-contaminate markers.

  markRecentSend(sessionId) {
    if (!sessionId) return;
    if (!this.recentSends) this.recentSends = {};
    if (!this._recentSendTimers) this._recentSendTimers = {};
    this.recentSends = { ...this.recentSends, [sessionId]: Date.now() };

    // Cancel any previously-scheduled safety-net for this session so a
    // rapid re-send doesn't leave a stale timer that might clear the
    // fresher marker early.
    if (this._recentSendTimers[sessionId]) {
      clearTimeout(this._recentSendTimers[sessionId]);
    }

    // Safety-net TTL removal in case the event-driven clear path (the
    // running → non-running status watcher) never fires. The handle is
    // tracked so `clearRecentSend` / `cancelAllRecentSendTimers` can
    // tear it down.
    this._recentSendTimers[sessionId] = setTimeout(() => {
      this._recentSendTimers[sessionId] = null;
      if (!this.recentSends) return;
      const entry = this.recentSends[sessionId];
      if (entry && Date.now() - entry >= RECENT_SEND_TTL_MS) {
        this.clearRecentSend(sessionId);
      }
    }, RECENT_SEND_TTL_MS);
  },

  clearRecentSend(sessionId) {
    if (!sessionId) return;
    if (this._recentSendTimers && this._recentSendTimers[sessionId]) {
      clearTimeout(this._recentSendTimers[sessionId]);
      this._recentSendTimers[sessionId] = null;
    }
    if (!this.recentSends) return;
    if (!(sessionId in this.recentSends)) return;
    const next = { ...this.recentSends };
    delete next[sessionId];
    this.recentSends = next;
  },

  /**
   * Tear down every outstanding safety-net timer. Call on store cleanup
   * (e.g. overlay `$cleanup`) to avoid leaking timers whose store
   * instance is gone.
   */
  cancelAllRecentSendTimers() {
    if (!this._recentSendTimers) return;
    for (const id of Object.keys(this._recentSendTimers)) {
      if (this._recentSendTimers[id]) {
        clearTimeout(this._recentSendTimers[id]);
        this._recentSendTimers[id] = null;
      }
    }
    this._recentSendTimers = {};
  },

  // ==================== SCHEDULE MUTATION COORDINATION ====================
  //
  // Tracks which schedule-related mutation (Start Now / Cancel) is in
  // flight per session on this store instance, so every control touching a
  // given scheduled session disables together — see the
  // `scheduleMutationInFlight` getter for the full rationale.

  /**
   * Claim the in-flight slot for a session's schedule mutation. Returns
   * `false` (and does nothing) if another mutation is already in flight for
   * this session on this store instance — callers should bail out rather
   * than proceed, so a guard here is effective even if a rapid double-click
   * beats the template's `:disabled` binding to the click handler.
   * @param {string} sessionId
   * @param {string} kind - 'starting' | 'cancelling'
   * @returns {boolean} true if the caller now owns the in-flight slot
   */
  beginScheduleMutation(sessionId, kind) {
    if (!sessionId) return false;
    if (!this.scheduleMutationsInFlight) this.scheduleMutationsInFlight = {};
    if (this.scheduleMutationsInFlight[sessionId]) return false;
    this.scheduleMutationsInFlight = { ...this.scheduleMutationsInFlight, [sessionId]: kind };
    return true;
  },

  /**
   * Release the in-flight slot for a session's schedule mutation. Safe to
   * call unconditionally from a `finally` block, including when
   * `beginScheduleMutation` returned false (no-op in that case).
   * @param {string} sessionId
   */
  endScheduleMutation(sessionId) {
    if (!sessionId || !this.scheduleMutationsInFlight) return;
    if (!(sessionId in this.scheduleMutationsInFlight)) return;
    const next = { ...this.scheduleMutationsInFlight };
    delete next[sessionId];
    this.scheduleMutationsInFlight = next;
  },
};
