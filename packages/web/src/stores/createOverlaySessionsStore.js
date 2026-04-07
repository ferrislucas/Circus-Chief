import { defineStore, getActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from './sessions.js';
import { tokenGetters } from './sessions/tokenGetters.js';
import { conversationActions } from './sessions/conversationActions.js';
import { perSessionActions } from './sessions/perSessionActions.js';
import { perSessionGetters } from './sessions/perSessionGetters.js';

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

  const store = defineStore(storeId, {
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

      // ==================== LOCAL GETTERS (shared with main store) ====================
      ...perSessionGetters,

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

      // ==================== PER-SESSION ACTIONS (shared with main store) ====================
      ...perSessionActions,

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

  // Attach $cleanup() to properly dispose and remove from Pinia registry.
  // $dispose() alone only removes subscriptions — it does NOT remove the
  // store's state entry from pinia.state.value, leaking memory on every
  // overlay open/close cycle.
  store.$cleanup = () => {
    store.$dispose();
    const pinia = getActivePinia();
    if (pinia) delete pinia.state.value[storeId];
  };

  return store;
}
