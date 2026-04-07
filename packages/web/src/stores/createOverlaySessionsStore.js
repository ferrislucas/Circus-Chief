import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from './sessions.js';
import { tokenGetters } from './sessions/tokenGetters.js';
import { conversationActions } from './sessions/conversationActions.js';

/**
 * Counter for generating unique store IDs across multiple overlay instances.
 */
let overlayCounter = 0;

/**
 * Factory that creates an isolated Pinia sessions store for the overlay.
 *
 * Isolated state (per-session fields that would otherwise cross-contaminate):
 *   currentSession, viewedSessionId, messages, conversations, activeConversationId,
 *   workLogs, partialThinkingBySession, partialText (+ throttle internals),
 *   runningUsage, loading, error, commandRunVersion
 *
 * Proxied getters (delegate to the main store for global / list-level data):
 *   sessions, archivedSessions, activeSessions, getSessionById, getRootSession,
 *   getChildSessions, hasChildren, getChildCount, getAllDescendants, getSessionPath,
 *   _findSessionById, _findChildren, groupedSessions, getWorkflowEffectiveStatus,
 *   getWorkflowAggregatedStatus, getWorkflowSessions
 *
 * Delegated actions (affect global session lists - call through to main store):
 *   updateSessionStatus, updateSession, stopSession, restartSession, startSession,
 *   sendMessage, updateSessionModel, updateSessionThinking, updateSessionMode,
 *   updateSessionFields, updateNextTemplate, updateAutoSendPendingPrompt
 */
export function createOverlaySessionsStore() {
  const storeId = `overlay-sessions-${++overlayCounter}`;

  return defineStore(storeId, {
    state: () => ({
      // Per-session isolated state
      currentSession: null,
      viewedSessionId: null,
      messages: [],
      conversations: [],
      activeConversationId: null,
      workLogs: {},
      partialThinkingBySession: {},
      partialText: '',
      _partialThrottleTimer: null,
      _pendingPartialText: null,
      runningUsage: null,
      loading: false,
      error: null,
      commandRunVersion: 0,
    }),

    getters: {
      // ==================== PROXIED GETTERS (delegate to main store) ====================

      sessions: () => useSessionsStore().sessions,
      archivedSessions: () => useSessionsStore().archivedSessions,
      activeSessions: () => useSessionsStore().activeSessions,

      _findSessionById() {
        return (id) => useSessionsStore()._findSessionById(id);
      },
      _findChildren() {
        return (parentId) => useSessionsStore()._findChildren(parentId);
      },
      getSessionById() {
        return (id) => useSessionsStore().getSessionById(id);
      },
      getChildSessions() {
        return (parentId) => useSessionsStore().getChildSessions(parentId);
      },
      hasChildren() {
        return (sessionId) => useSessionsStore().hasChildren(sessionId);
      },
      getChildCount() {
        return (sessionId) => useSessionsStore().getChildCount(sessionId);
      },
      getAllDescendants() {
        return (sessionId) => useSessionsStore().getAllDescendants(sessionId);
      },
      getSessionPath() {
        return (sessionId) => useSessionsStore().getSessionPath(sessionId);
      },
      getRootSession() {
        return (sessionId) => useSessionsStore().getRootSession(sessionId);
      },
      getWorkflowEffectiveStatus() {
        return (rootSessionId) => useSessionsStore().getWorkflowEffectiveStatus(rootSessionId);
      },
      getWorkflowAggregatedStatus() {
        return (rootSessionId) => useSessionsStore().getWorkflowAggregatedStatus(rootSessionId);
      },
      getWorkflowSessions() {
        return (rootSessionId) => useSessionsStore().getWorkflowSessions(rootSessionId);
      },
      groupedSessions() {
        return useSessionsStore().groupedSessions;
      },

      // ==================== LOCAL GETTERS (operate on isolated state) ====================

      isDraftSession: (state) => (session) => {
        if (!session || session.status !== 'waiting') return false;
        if (session.hasResponses !== undefined) return !session.hasResponses;
        return !state.messages.some((msg) => msg.role === 'assistant');
      },

      isScheduledDraft: (state) => (session) => {
        if (!session || session.status !== 'scheduled') return false;
        if (session.hasResponses !== undefined) return !session.hasResponses;
        return !state.messages.some((msg) => msg.role === 'assistant');
      },

      getWorkLogsForMessage: (state) => (messageId) => {
        return state.workLogs[messageId] || [];
      },
      getUnassociatedWorkLogs: (state) => {
        return state.workLogs['_unassociated'] || [];
      },
      partialThinking: (state) => {
        if (!state.currentSession?.id) return null;
        return state.partialThinkingBySession[state.currentSession.id] || null;
      },
      activeConversation: (state) => {
        return state.conversations.find((c) => c.id === state.activeConversationId) || null;
      },
      getConversationById: (state) => (id) => {
        return state.conversations.find((c) => c.id === id);
      },
      rootConversations: (state) => {
        return state.conversations.filter((c) => !c.parentConversationId);
      },
      conversationTree: (state) => {
        const buildTree = (parentId = null) => {
          return state.conversations
            .filter((c) => c.parentConversationId === parentId)
            .map((conv) => ({ ...conv, children: buildTree(conv.id) }));
        };
        return buildTree(null);
      },
      getConversationChildren: (state) => (conversationId) => {
        return state.conversations.filter((c) => c.parentConversationId === conversationId);
      },
      getConversationParent: (state) => (conversationId) => {
        const conv = state.conversations.find((c) => c.id === conversationId);
        if (!conv?.parentConversationId) return null;
        return state.conversations.find((c) => c.id === conv.parentConversationId);
      },

      // ==================== TOKEN USAGE GETTERS (operate on local state) ====================
      ...tokenGetters,
    },

    actions: {
      // ==================== LOCAL SESSION LIST HELPER ====================

      _updateSessionInAllLists(sessionId, updates) {
        // Update local currentSession
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, ...updates };
        }
        // Also delegate to the main store so global session lists stay in sync
        useSessionsStore()._updateSessionInAllLists(sessionId, updates);
      },

      // ==================== SESSION FETCH (local state + main store sync) ====================

      async fetchSession(id, showLoading = true) {
        if (showLoading) this.loading = true;
        this.error = null;
        try {
          const fetchedSession = await api.getSession(id);

          // Guard: only set currentSession if still viewing this session
          if (this.viewedSessionId && this.viewedSessionId !== id) {
            return;
          }

          this.currentSession = fetchedSession;

          // Also update the main store's session list so getSessionById() works
          const mainStore = useSessionsStore();
          const existingIndex = mainStore.sessions.findIndex((s) => s.id === id);
          if (existingIndex !== -1) {
            mainStore.sessions[existingIndex] = fetchedSession;
          } else {
            mainStore.sessions.push(fetchedSession);
          }
        } catch (err) {
          this.error = err.message;
        } finally {
          if (showLoading) this.loading = false;
        }
      },

      // ==================== MESSAGE ACTIONS (local state) ====================

      async fetchMessages(sessionId, showLoading = true, conversationId = null) {
        if (this.viewedSessionId && this.viewedSessionId !== sessionId) return;

        if (showLoading) this.loading = true;
        this.error = null;
        try {
          const cid = conversationId || this.activeConversationId;
          const fetchedMessages = cid
            ? await api.getConversationMessages(sessionId, cid)
            : await api.getSessionMessages(sessionId);

          if (this.viewedSessionId && this.viewedSessionId !== sessionId) return;

          const fetchedIds = new Set(fetchedMessages.map(m => m.id));
          const newMessages = this.messages.filter(m => m.sessionId === sessionId && !fetchedIds.has(m.id));
          if (newMessages.length > 0) {
            this.messages = [...fetchedMessages, ...newMessages];
          } else {
            this.messages = fetchedMessages;
          }
        } catch (err) {
          if (this.viewedSessionId && this.viewedSessionId === sessionId) {
            this.error = err.message;
          }
        } finally {
          if (showLoading) this.loading = false;
        }
      },

      addMessage(message) {
        if (this.currentSession && message.sessionId && message.sessionId !== this.currentSession.id) return;
        if (!this.messages.some(m => m.id === message.id)) this.messages.push(message);
      },

      // ==================== WORK LOG ACTIONS (local state) ====================

      async fetchWorkLogs(sessionId) {
        if (this.viewedSessionId && this.viewedSessionId !== sessionId) return;
        this.error = null;
        try {
          const grouped = await api.getSessionWorkLogs(sessionId);
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
          if (this.viewedSessionId && this.viewedSessionId === sessionId) {
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

      // ==================== STREAMING ACTIONS (local state) ====================

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

      // ==================== USAGE ACTIONS (local state) ====================

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

      // ==================== DELEGATED ACTIONS (call through to main store) ====================

      updateSessionStatus(sessionId, status) {
        // Update local currentSession
        const session = this.currentSession?.id === sessionId ? this.currentSession : null;
        const wasRunning = session?.status === 'running';
        const updates = { status };
        if (wasRunning && (status === 'waiting' || status === 'completed')) updates.hasResponses = true;
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, ...updates };
        }
        // Also update main store
        useSessionsStore().updateSessionStatus(sessionId, status);
      },

      updateSession(sessionData) {
        if (!sessionData?.id) return;
        // Update local currentSession
        if (this.currentSession?.id === sessionData.id) {
          this.currentSession = { ...this.currentSession, ...sessionData };
        }
        // Also update main store
        useSessionsStore().updateSession(sessionData);
      },

      async stopSession(id) {
        return useSessionsStore().stopSession(id);
      },

      async restartSession(id) {
        return useSessionsStore().restartSession(id);
      },

      async startSession(id, prompt = undefined, model = undefined) {
        return useSessionsStore().startSession(id, prompt, model);
      },

      async sendMessage(sessionId, content, files = [], model = null) {
        return useSessionsStore().sendMessage(sessionId, content, files, model);
      },

      async updateSessionModel(sessionId, model, providerId = undefined) {
        const result = await useSessionsStore().updateSessionModel(sessionId, model, providerId);
        // Sync local currentSession
        if (this.currentSession?.id === sessionId) {
          const updateData = { model };
          if (providerId !== undefined) updateData.providerId = providerId;
          if (this.currentSession.status === 'waiting') updateData.pendingModel = model;
          this.currentSession = { ...this.currentSession, ...updateData };
        }
        return result;
      },

      async updateSessionThinking(sessionId, thinkingEnabled) {
        return this.updateSessionFields(sessionId, { thinkingEnabled });
      },

      async updateSessionMode(sessionId, mode) {
        return this.updateSessionFields(sessionId, { mode });
      },

      async updateSessionFields(sessionId, updates) {
        const result = await useSessionsStore().updateSessionFields(sessionId, updates);
        // Sync local currentSession
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, ...updates };
        }
        return result;
      },

      async updateNextTemplate(sessionId, nextTemplateId) {
        return this.updateSessionFields(sessionId, { nextTemplateId });
      },

      async updateAutoSendPendingPrompt(sessionId, autoSendPendingPrompt) {
        return this.updateSessionFields(sessionId, { autoSendPendingPrompt });
      },

      // ==================== COMMAND RUN (delegate to main store) ====================

      updateSessionCommandRun(sessionId, buttonId, runData) {
        useSessionsStore().updateSessionCommandRun(sessionId, buttonId, runData);
        this.commandRunVersion++;
      },

      removeSessionCommandRun(sessionId, buttonId) {
        useSessionsStore().removeSessionCommandRun(sessionId, buttonId);
        this.commandRunVersion++;
      },

      updateSessionCommandRuns(sessionId, runs) {
        useSessionsStore().updateSessionCommandRuns(sessionId, runs);
        this.commandRunVersion++;
      },

      // ==================== CONVERSATION ACTIONS (spread from shared module) ====================
      ...conversationActions,
    },
  })();
}
