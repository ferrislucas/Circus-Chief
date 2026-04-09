import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useSessionFiltersStore } from './sessionFilters.js';
import { tokenGetters } from './sessions/tokenGetters.js';
import { sessionActions } from './sessions/sessionActions.js';
import { conversationActions } from './sessions/conversationActions.js';
import { perSessionActions } from './sessions/perSessionActions.js';
import { perSessionGetters } from './sessions/perSessionGetters.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
    archivedSessions: [],
    activeSessions: [],
    scheduledSessions: [],
    currentSession: null,
    // Tracks which session the user is actively viewing in SessionDetailView.
    // Used to guard fetchSession() against stale in-flight requests overwriting
    // currentSession after the user has navigated to a different session.
    viewedSessionId: null,
    messages: [],
    conversations: [],
    activeConversationId: null,
    workLogs: {},
    partialThinkingBySession: {},
    partialText: '',
    _partialThrottleTimer: null,
    _pendingPartialText: null,
    statusFilter: null,
    starredFilter: null,
    scheduledFilter: null,
    runningUsage: null,
    loading: false,
    loadingScheduled: false,
    error: null,
    commandRunVersion: 0,
    archivedPagination: {
      total: 0,
      offset: 0,
      hasMore: false,
      loading: false,
    },
  }),

  getters: {
    // ==================== SESSION GETTERS ====================

    // Helper: find a session by ID across both arrays (sessions first, then activeSessions)
    _findSessionById: (state) => (id) => state.sessions.find((s) => s.id === id) || state.activeSessions.find((s) => s.id === id),

    // Helper: find children across both store arrays (deduplicated)
    _findChildren: (state) => (parentId) => {
      const fromSessions = state.sessions.filter(s => s.parentSessionId === parentId);
      const fromActive = state.activeSessions.filter(s => s.parentSessionId === parentId);
      const seen = new Set(fromSessions.map(s => s.id));
      const merged = [...fromSessions];
      for (const s of fromActive) {
        if (!seen.has(s.id)) { merged.push(s); seen.add(s.id); }
      }
      return merged;
    },

    getSessionById: (state) => (id) => state.sessions.find((s) => s.id === id),

    getChildSessions() { return (parentId) => this._findChildren(parentId); },

    hasChildren() { return (sessionId) => this._findChildren(sessionId).length > 0; },

    getChildCount() { return (sessionId) => this._findChildren(sessionId).length; },

    getAllDescendants() {
      return (sessionId) => {
        const descendants = [];
        const stack = [sessionId];
        const visited = new Set();
        while (stack.length > 0) {
          const currentId = stack.pop();
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          const children = this._findChildren(currentId);
          for (const child of children) {
            descendants.push(child);
            stack.push(child.id);
          }
        }
        return descendants;
      };
    },

    getWorkflowEffectiveStatus() {
      return (rootSessionId) => {
        const root = this._findSessionById(rootSessionId);
        if (!root) return 'idle';
        const allSessions = [root];
        const stack = [rootSessionId];
        const visited = new Set();
        while (stack.length > 0) {
          const currentId = stack.pop();
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          const children = this._findChildren(currentId);
          for (const child of children) {
            allSessions.push(child);
            stack.push(child.id);
          }
        }
        const runningStatuses = ['running', 'starting'];
        return allSessions.some((s) => runningStatuses.includes(s.status)) ? 'running' : 'idle';
      };
    },

    getSessionPath() {
      return (sessionId) => {
        const path = [];
        const findSession = (id) => {
          if (this.currentSession?.id === id) return this.currentSession;
          return this._findSessionById(id);
        };
        let current = findSession(sessionId);
        while (current) {
          path.unshift(current);
          if (!current.parentSessionId) break;
          current = findSession(current.parentSessionId);
        }
        return path;
      };
    },

    getRootSession() {
      return (sessionId) => {
        let current = this._findSessionById(sessionId);
        while (current?.parentSessionId) {
          current = this._findSessionById(current.parentSessionId);
        }
        return current || null;
      };
    },

    getWorkflowAggregatedStatus() {
      return (rootSessionId) => {
        const root = this._findSessionById(rootSessionId);
        if (!root) {
          return {
            effectiveStatus: 'idle', runningCount: 0, scheduledCount: 0,
            waitingCount: 0, completedCount: 0, totalCount: 0,
            hasScheduledDescendant: false, rootIsScheduled: false,
          };
        }
        const allSessions = [root];
        const stack = [rootSessionId];
        const visited = new Set();
        while (stack.length > 0) {
          const currentId = stack.pop();
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          const children = this._findChildren(currentId);
          for (const child of children) { allSessions.push(child); stack.push(child.id); }
        }
        const runningStatuses = ['running', 'starting'];
        let runningCount = 0, scheduledCount = 0, waitingCount = 0, completedCount = 0;
        for (const session of allSessions) {
          if (runningStatuses.includes(session.status)) runningCount++;
          else if (session.status === 'scheduled') scheduledCount++;
          else if (session.status === 'waiting') waitingCount++;
          else if (session.status === 'completed' || session.status === 'stopped') completedCount++;
        }
        return {
          effectiveStatus: runningCount > 0 ? 'running' : 'idle',
          runningCount,
          scheduledCount,
          waitingCount,
          completedCount,
          totalCount: allSessions.length - 1,
          hasScheduledDescendant: allSessions.slice(1).some((s) => s.status === 'scheduled'),
          rootIsScheduled: root.status === 'scheduled',
        };
      };
    },

    getWorkflowSessions() {
      return (rootSessionId) => {
        const root = this._findSessionById(rootSessionId);
        if (!root) return [];
        const all = [root];
        const stack = [rootSessionId];
        const visited = new Set();
        while (stack.length > 0) {
          const currentId = stack.pop();
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          const children = this._findChildren(currentId);
          for (const child of children) { all.push(child); stack.push(child.id); }
        }
        return all;
      };
    },

    groupedSessions: (state) => {
      const grouped = [];
      const seen = new Set();
      state.sessions.forEach((session) => {
        if (!session.parentSessionId && !seen.has(session.id)) {
          grouped.push({
            parent: session,
            children: state.sessions.filter((s) => s.parentSessionId === session.id),
          });
          seen.add(session.id);
        }
      });
      state.sessions.forEach((session) => {
        if (!session.parentSessionId && !grouped.find((g) => g.parent.id === session.id)) {
          grouped.push({ parent: session, children: [] });
        }
      });
      return grouped;
    },

    // ==================== PER-SESSION GETTERS (shared with overlay store) ====================
    ...perSessionGetters,

    // ==================== TOKEN USAGE GETTERS ====================
    ...tokenGetters,
  },

  actions: {
    // ==================== SESSION LIST HELPERS ====================

    _updateSessionInAllLists(sessionId, updates) {
      const updateInArray = (arrInput, index) => {
        const arr = arrInput;
        if (index !== -1) arr[index] = { ...arr[index], ...updates };
      };
      updateInArray(this.sessions, this.sessions.findIndex(s => s.id === sessionId));
      updateInArray(this.archivedSessions, this.archivedSessions.findIndex(s => s.id === sessionId));
      updateInArray(this.activeSessions, this.activeSessions.findIndex(s => s.id === sessionId));
      if (this.currentSession?.id === sessionId) {
        this.currentSession = { ...this.currentSession, ...updates };
      }
    },

    // ==================== SESSION FETCH & CRUD ACTIONS ====================
    ...sessionActions,

    // ==================== FILTER ACTIONS (delegate to sessionFilters store) ====================

    setStatusFilter(filter) {
      this.statusFilter = filter;
      this._syncFilterToSubStore('statusFilter');
      this._filtersStore().saveStatusFilter();
    },
    saveStatusFilter() {
      this._syncFilterToSubStore('statusFilter');
      this._filtersStore().saveStatusFilter();
    },
    restoreStatusFilter() {
      this._filtersStore().restoreStatusFilter();
      this.statusFilter = this._filtersStore().statusFilter;
    },
    setStarredFilter(filter) {
      this.starredFilter = filter;
      this._syncFilterToSubStore('starredFilter');
      this._filtersStore().saveStarredFilter();
    },
    saveStarredFilter() {
      this._syncFilterToSubStore('starredFilter');
      this._filtersStore().saveStarredFilter();
    },
    restoreStarredFilter() {
      this._filtersStore().restoreStarredFilter();
      this.starredFilter = this._filtersStore().starredFilter;
    },
    setScheduledFilter(filter) {
      this.scheduledFilter = filter;
      this._syncFilterToSubStore('scheduledFilter');
      this._filtersStore().saveScheduledFilter();
    },
    saveScheduledFilter() {
      this._syncFilterToSubStore('scheduledFilter');
      this._filtersStore().saveScheduledFilter();
    },
    restoreScheduledFilter() {
      this._filtersStore().restoreScheduledFilter();
      this.scheduledFilter = this._filtersStore().scheduledFilter;
    },
    _filtersStore() { return useSessionFiltersStore(); },
    _syncFilterToSubStore(key) {
      this._filtersStore()[key] = this[key];
    },

    // ==================== COMMAND RUN ====================

    updateSessionCommandRun(sessionId, buttonId, runData) {
      const getUpdatedRuns = (session) => {
        if (!session) return null;
        const runs = [...(session.latestCommandRuns || [])];
        const existingIdx = runs.findIndex(r => r.buttonId === buttonId);
        if (existingIdx >= 0) runs[existingIdx] = runData;
        else runs.push(runData);
        return runs;
      };
      const source = this.sessions.find(s => s.id === sessionId)
        || this.archivedSessions.find(s => s.id === sessionId)
        || this.activeSessions.find(s => s.id === sessionId)
        || this.currentSession;
      const updatedRuns = getUpdatedRuns(source);
      if (updatedRuns) this._updateSessionInAllLists(sessionId, { latestCommandRuns: updatedRuns });
      this.commandRunVersion++;
    },

    removeSessionCommandRun(sessionId, buttonId) {
      const source = this.sessions.find(s => s.id === sessionId)
        || this.archivedSessions.find(s => s.id === sessionId)
        || this.activeSessions.find(s => s.id === sessionId)
        || this.currentSession;
      if (!source) return;
      const runs = (source.latestCommandRuns || []).filter(r => r.buttonId !== buttonId);
      this._updateSessionInAllLists(sessionId, { latestCommandRuns: runs });
      this.commandRunVersion++;
    },

    updateSessionCommandRuns(sessionId, runs) {
      this._updateSessionInAllLists(sessionId, { latestCommandRuns: runs });
      this.commandRunVersion++;
    },

    // ==================== PER-SESSION ACTIONS (shared with overlay store) ====================
    ...perSessionActions,

    // ==================== CONVERSATION ACTIONS ====================
    ...conversationActions,
  },
});
