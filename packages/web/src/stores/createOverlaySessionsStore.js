import { defineStore, getActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from './sessions.js';
import { tokenGetters } from './sessions/tokenGetters.js';
import { conversationActions } from './sessions/conversationActions.js';
import { perSessionActions } from './sessions/perSessionActions.js';
import { perSessionGetters } from './sessions/perSessionGetters.js';
import {
  statusOrderingState,
  statusOrderingActions,
  debugSessionStatus,
} from './sessions/statusOrdering.js';

/**
 * Counter for generating unique store IDs across multiple overlay instances.
 */
let overlayCounter = 0;

/**
 * Initial state for an isolated overlay sessions store.
 * Keeps per-session fields separate from the main store to prevent cross-contamination.
 */
function overlayState() {
  return {
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
    // Per-session timestamps for "recently sent" markers. Scoped per overlay
    // instance so markers set via Send/Start in the overlay don't leak into
    // the main store (and vice-versa). See `markRecentSend` / `hasRecentSend`.
    recentSends: {},
    // Per-session in-flight schedule mutation kind, scoped per overlay
    // instance for the same reason as `recentSends`. See
    // `scheduleMutationInFlight` in perSessionGetters.js.
    scheduleMutationsInFlight: {},
    // Per-session status ordering generations (see statusOrdering.js). Kept
    // per overlay instance so each overlay guards its own currentSession
    // against stale snapshots independently of the main store.
    ...statusOrderingState(),
  };
}

/**
 * Getters for the overlay sessions store.
 * Global / list-level getters proxy through to the main store, while per-session
 * and token usage getters operate on the overlay's own local state.
 */
const overlayGetters = {
  // ==================== PROXIED GETTERS (delegate to main store) ====================

  sessions: () => useSessionsStore().sessions,
  archivedSessions: () => useSessionsStore().archivedSessions,

  _findSessionById() { return (id) => useSessionsStore()._findSessionById(id); },
  _findChildren() { return (parentId) => useSessionsStore()._findChildren(parentId); },
  getSessionById() { return (id) => useSessionsStore().getSessionById(id); },
  getChildSessions() { return (parentId) => useSessionsStore().getChildSessions(parentId); },
  hasChildren() { return (sessionId) => useSessionsStore().hasChildren(sessionId); },
  getChildCount() { return (sessionId) => useSessionsStore().getChildCount(sessionId); },
  getAllDescendants() { return (sessionId) => useSessionsStore().getAllDescendants(sessionId); },
  getSessionPath() { return (sessionId) => useSessionsStore().getSessionPath(sessionId); },
  getRootSession() { return (sessionId) => useSessionsStore().getRootSession(sessionId); },
  getWorkflowEffectiveStatus() {
    return (rootSessionId) => useSessionsStore().getWorkflowEffectiveStatus(rootSessionId);
  },
  getWorkflowAggregatedStatus() {
    return (rootSessionId) => useSessionsStore().getWorkflowAggregatedStatus(rootSessionId);
  },
  getWorkflowSessions() {
    return (rootSessionId) => useSessionsStore().getWorkflowSessions(rootSessionId);
  },
  groupedSessions() { return useSessionsStore().groupedSessions; },

  // ==================== LOCAL GETTERS (shared with main store) ====================
  ...perSessionGetters,

  // ==================== TOKEN USAGE GETTERS (operate on local state) ====================
  ...tokenGetters,
};

/**
 * Actions that mutate both the overlay's local state and the main store.
 */
const sessionSyncActions = {
  _updateSessionInAllLists(sessionId, updates) {
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, ...updates };
    }
    // Bump this store's ordering generation for status-bearing updates so a
    // snapshot fetched before the update cannot regress currentSession
    // afterwards (see statusOrdering.js).
    if (updates?.status !== undefined) this._bumpStatusGeneration(sessionId);
    useSessionsStore()._updateSessionInAllLists(sessionId, updates);
  },

  async fetchSession(id, showLoading = true) {
    if (showLoading) this.loading = true;
    this.error = null;
    try {
      // Capture the ordering generation before the request so a lifecycle
      // status applied while the fetch is in flight cannot be overwritten
      // by this snapshot's (older) status. See statusOrdering.js.
      const generationAtRequest = this._statusGeneration(id);
      const fetchedSession = await api.getSession(id);
      if (this.viewedSessionId && this.viewedSessionId !== id) return;
      const snapshot = this._reconcileSnapshotWithStatusOrdering(id, fetchedSession, generationAtRequest);
      this.currentSession = snapshot;

      const mainStore = useSessionsStore();
      const existingIndex = mainStore.sessions.findIndex((s) => s.id === id);
      if (existingIndex !== -1) {
        mainStore.sessions[existingIndex] = snapshot;
      } else {
        mainStore.sessions.push(snapshot);
      }
    } catch (err) {
      this.error = err.message;
    } finally {
      if (showLoading) this.loading = false;
    }
  },

  updateSessionStatus(sessionId, status) {
    const session = this.currentSession?.id === sessionId ? this.currentSession : null;
    const wasRunning = session?.status === 'running';
    const updates = { status };
    if (wasRunning && (status === 'waiting' || status === 'completed')) updates.hasResponses = true;
    debugSessionStatus('socket', sessionId, status, this._statusGeneration(sessionId) + 1);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = { ...this.currentSession, ...updates };
    }
    // Bump this store's ordering generation (lifecycle frames are newer than
    // any snapshot issued before them). The main store bumps its own
    // generation inside its updateSessionStatus.
    this._bumpStatusGeneration(sessionId);
    useSessionsStore().updateSessionStatus(sessionId, status);
  },

  updateSession(sessionData) {
    if (!sessionData?.id) return;
    if (this.currentSession?.id === sessionData.id) {
      this.currentSession = { ...this.currentSession, ...sessionData };
    }
    if (sessionData.status !== undefined) this._bumpStatusGeneration(sessionData.id);
    useSessionsStore().updateSession(sessionData);
  },
};

/**
 * Command wrappers around the main store's lifecycle actions.
 *
 * The delegated main-store action only updates the MAIN store's lists; the
 * overlay's canonical `currentSession` would otherwise stay in its prior
 * state until a `session:status` WebSocket frame happened to arrive (the
 * missed-frame failure path this store exists to prevent). After the API
 * ACCEPTS the operation, these wrappers immediately transition the overlay's
 * own session to the active state (FR-1). On a rejected request nothing is
 * mutated locally — the error propagates to the caller's existing error path.
 */
const delegatedSessionActions = {
  async stopSession(id) { return useSessionsStore().stopSession(id); },
  async restartSession(id) { return useSessionsStore().restartSession(id); },
  // eslint-disable-next-line max-params -- delegates the existing positional start signature plus optional `options` bag
  async startSession(id, prompt = undefined, model = undefined, providerId = undefined, options = {}) {
    const result = await useSessionsStore().startSession(id, prompt, model, providerId, options);
    // API accepted the start: the overlay's session is now `starting` (FR-1).
    // Runs through updateSessionStatus so the ordering generation advances.
    debugSessionStatus('optimistic', id, 'starting', this._statusGeneration(id) + 1);
    this.updateSessionStatus(id, 'starting');
    return result;
  },
  // eslint-disable-next-line max-params -- delegates the existing positional send signature plus optional `options` bag
  async sendMessage(sessionId, content, files = [], model = null, options = {}) {
    const result = await useSessionsStore().sendMessage(sessionId, content, files, model, options);
    // API accepted the send: the overlay's session is now `running` (FR-1).
    // Runs through updateSessionStatus so the ordering generation advances.
    debugSessionStatus('optimistic', sessionId, 'running', this._statusGeneration(sessionId) + 1);
    this.updateSessionStatus(sessionId, 'running');
    return result;
  },

  async updateSessionModel(sessionId, model, providerId = undefined) {
    const result = await useSessionsStore().updateSessionModel(sessionId, model, providerId);
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

  async runScheduledNow(sessionId, prompt) {
    const result = await useSessionsStore().runScheduledNow(sessionId, prompt);
    // Merge the authoritative response into the overlay's canonical session
    // (and the shared lists), reflecting the returned active status locally.
    // Goes through _updateSessionInAllLists so the ordering generation
    // advances ahead of any snapshot already in flight.
    if (result) {
      debugSessionStatus('optimistic', sessionId, result.status, this._statusGeneration(sessionId) + 1);
      this._updateSessionInAllLists(sessionId, result);
    }
    return result;
  },

  async updateSessionFields(sessionId, updates) {
    const result = await useSessionsStore().updateSessionFields(sessionId, updates);
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
};

/**
 * Command run tracking actions - delegate to main store and bump local version.
 */
const commandRunActions = {
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
};

/**
 * Combined actions object for the overlay sessions store.
 */
const overlayActions = {
  ...sessionSyncActions,
  ...statusOrderingActions,
  ...perSessionActions,
  ...delegatedSessionActions,
  ...commandRunActions,
  ...conversationActions,
};

/**
 * Factory that creates an isolated Pinia sessions store for the overlay.
 *
 * Isolated state (per-session fields that would otherwise cross-contaminate):
 *   currentSession, viewedSessionId, messages, conversations, activeConversationId,
 *   workLogs, partialThinkingBySession, partialText (+ throttle internals),
 *   runningUsage, loading, error, commandRunVersion
 *
 * Proxied getters (delegate to the main store for global / list-level data):
 *   sessions, archivedSessions, getSessionById, getRootSession,
 *   getChildSessions, hasChildren, getChildCount, getAllDescendants, getSessionPath,
 *   _findSessionById, _findChildren, groupedSessions, getWorkflowEffectiveStatus,
 *   getWorkflowAggregatedStatus, getWorkflowSessions
 *
 * Delegated actions (affect global session lists - call through to main store):
 *   updateSessionStatus, updateSession, stopSession, restartSession, startSession,
 *   sendMessage, updateSessionModel, updateSessionThinking, updateSessionMode,
 *   updateSessionFields, updateNextTemplate, updateAutoSendPendingPrompt, runScheduledNow
 *
 * Lifecycle wrappers (sendMessage / startSession / runScheduledNow) also sync
 * the overlay's own `currentSession` to the active state once the API accepts
 * the operation, so the overlay never renders an idle composer for a session
 * it just started (FR-1 of the running-state FRD).
 */
export function createOverlaySessionsStore() {
  const storeId = `overlay-sessions-${++overlayCounter}`;

  const store = defineStore(storeId, {
    state: overlayState,
    getters: overlayGetters,
    actions: overlayActions,
  })();

  // Attach $cleanup() to properly dispose and remove from Pinia registry.
  // $dispose() alone only removes subscriptions — it does NOT remove the
  // store's state entry from pinia.state.value, leaking memory on every
  // overlay open/close cycle.
  store.$cleanup = () => {
    // Tear down any outstanding recent-send safety-net timers so they
    // don't fire against a disposed store instance.
    if (typeof store.cancelAllRecentSendTimers === 'function') {
      store.cancelAllRecentSendTimers();
    }
    store.$dispose();
    const pinia = getActivePinia();
    if (pinia) delete pinia.state.value[storeId];
  };

  return store;
}
