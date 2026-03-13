import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { calculateBillableTokens, formatTokenCount } from '@claudetools/shared';
import { useSettingsStore } from './settings.js';
import { useSessionFiltersStore } from './sessionFilters.js';
import { useSessionStreamingStore } from './sessionStreaming.js';
import { useSessionConversationsStore } from './sessionConversations.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
    archivedSessions: [],
    activeSessions: [],
    scheduledSessions: [],
    currentSession: null,
    messages: [],
    conversations: [],
    activeConversationId: null,
    workLogs: {},
    partialThinkingBySession: {},
    partialText: '',
    _partialThrottleTimer: null,
    _pendingPartialText: null,
    expandedSessions: new Set(),
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

    getSessionById: (state) => (id) => {
      return state.sessions.find((s) => s.id === id);
    },

    // Parent-child relationship getters
    getChildSessions: (state) => (parentId) => {
      return state.sessions.filter((s) => s.parentSessionId === parentId);
    },

    hasChildren: (state) => (sessionId) => {
      return state.sessions.some((s) => s.parentSessionId === sessionId);
    },

    getChildCount: (state) => (sessionId) => {
      return state.sessions.filter((s) => s.parentSessionId === sessionId).length;
    },

    isSessionExpanded: (state) => (sessionId) => {
      return state.expandedSessions.has(sessionId);
    },

    getAllDescendants: (state) => (sessionId) => {
      const descendants = [];
      const stack = [sessionId];
      const visited = new Set();
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const children = state.sessions.filter((s) => s.parentSessionId === currentId);
        for (const child of children) {
          descendants.push(child);
          stack.push(child.id);
        }
      }
      return descendants;
    },

    getWorkflowEffectiveStatus: (state) => (rootSessionId) => {
      const root = state.sessions.find((s) => s.id === rootSessionId);
      if (!root) return 'idle';
      const allSessions = [root];
      const stack = [rootSessionId];
      const visited = new Set();
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const children = state.sessions.filter((s) => s.parentSessionId === currentId);
        for (const child of children) {
          allSessions.push(child);
          stack.push(child.id);
        }
      }
      const runningStatuses = ['running', 'starting'];
      return allSessions.some((s) => runningStatuses.includes(s.status)) ? 'running' : 'idle';
    },

    getSessionPath: (state) => (sessionId) => {
      const path = [];
      const findSession = (id) => {
        if (state.currentSession?.id === id) return state.currentSession;
        return state.sessions.find((s) => s.id === id);
      };
      let current = findSession(sessionId);
      while (current) {
        path.unshift(current);
        if (!current.parentSessionId) break;
        current = findSession(current.parentSessionId);
      }
      return path;
    },

    getRootSession: (state) => (sessionId) => {
      let current = state.sessions.find((s) => s.id === sessionId);
      while (current?.parentSessionId) {
        current = state.sessions.find((s) => s.id === current.parentSessionId);
      }
      return current || null;
    },

    getWorkflowAggregatedStatus: (state) => (rootSessionId) => {
      const root = state.sessions.find((s) => s.id === rootSessionId);
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
        const children = state.sessions.filter((s) => s.parentSessionId === currentId);
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

    // ==================== DELEGATED CONVERSATION GETTERS ====================
    // These delegate to the conversations sub-store state (kept on this store for backward compat)

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

    // ==================== TOKEN USAGE GETTERS ====================

    conversationTokens: (state) => {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      return conv
        ? {
            inputTokens: conv.inputTokens || 0, outputTokens: conv.outputTokens || 0,
            cacheReadInputTokens: conv.cacheReadInputTokens || 0,
            cacheCreationInputTokens: conv.cacheCreationInputTokens || 0,
            webSearchRequests: conv.webSearchRequests || 0, contextWindow: conv.contextWindow || 200000,
          }
        : null;
    },
    totalTokens: (state) => {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (conv) return (conv.inputTokens || 0) + (conv.outputTokens || 0);
      if (!state.currentSession) return 0;
      return (state.currentSession.inputTokens || 0) + (state.currentSession.outputTokens || 0);
    },
    formattedTokens: (state) => {
      const format = (n) => {
        if (n === null || n === undefined) return '-';
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
      };
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                           state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const totalInput = (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
          const totalOutput = (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
          return {
            input: format(totalInput), output: format(totalOutput),
            total: format(totalInput + totalOutput),
            cacheRead: format((conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0)),
            cacheCreation: format((conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0)),
          };
        }
      }
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (conv) {
          return {
            input: format(conv.inputTokens), output: format(conv.outputTokens),
            total: format((conv.inputTokens || 0) + (conv.outputTokens || 0)),
            cacheRead: format(conv.cacheReadInputTokens), cacheCreation: format(conv.cacheCreationInputTokens),
          };
        }
      }
      return { input: '-', output: '-', total: '-', cacheRead: '-', cacheCreation: '-' };
    },
    contextPercentage: (state) => {
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const totalInput = (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
          const totalOutput = (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
          const total = totalInput + totalOutput;
          const contextWindow = state.runningUsage.contextWindow || conv?.contextWindow || 200000;
          return Math.min(100, Math.round((total / contextWindow) * 100));
        }
      }
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      const source = conv || state.currentSession;
      if (!source) return 0;
      const totalTokens = (source.inputTokens || 0) + (source.outputTokens || 0);
      return Math.min(100, Math.round((totalTokens / (source.contextWindow || 200000)) * 100));
    },
    isUsageUpdating: (state) => {
      if (!state.runningUsage) return false;
      if (state.activeConversationId && state.runningUsage.conversationId !== state.activeConversationId) return false;
      return true;
    },
    getConversationDisplayTokens: (state) => (conversationId) => {
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) return { inputTokens: 0, outputTokens: 0, total: 0 };
      if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
        const totalInput = (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0);
        const totalOutput = (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0);
        return { inputTokens: totalInput, outputTokens: totalOutput, total: totalInput + totalOutput };
      }
      return {
        inputTokens: conv.inputTokens || 0, outputTokens: conv.outputTokens || 0,
        total: (conv.inputTokens || 0) + (conv.outputTokens || 0),
      };
    },
    billableTokens: (state) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          return calculateBillableTokens({
            inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
            outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
            cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
            cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
          }, weights);
        }
      }
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (conv) {
          return calculateBillableTokens({
            inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
            cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
          }, weights);
        }
      }
      return 0;
    },
    formattedBillableTokens: (state) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          return formatTokenCount(calculateBillableTokens({
            inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
            outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
            cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
            cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
          }, weights));
        }
      }
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (conv) {
          return formatTokenCount(calculateBillableTokens({
            inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
            cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
          }, weights));
        }
      }
      return '-';
    },
    getConversationBillableTokens: (state) => (conversationId) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;
      const conv = state.conversations.find(c => c.id === conversationId);
      if (!conv) return 0;
      if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
        return calculateBillableTokens({
          inputTokens: (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
          outputTokens: (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
          cacheReadInputTokens: (conv.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
          cacheCreationInputTokens: (conv.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
        }, weights);
      }
      return calculateBillableTokens({
        inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
        cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
      }, weights);
    },
    getFormattedConversationBillableTokens: (state) => (conversationId) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;
      const conv = state.conversations.find(c => c.id === conversationId);
      if (!conv) return '-';
      let usage;
      if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
        usage = {
          inputTokens: (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
          outputTokens: (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
          cacheReadInputTokens: (conv.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
          cacheCreationInputTokens: (conv.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
        };
      } else {
        usage = {
          inputTokens: conv.inputTokens, outputTokens: conv.outputTokens,
          cacheReadInputTokens: conv.cacheReadInputTokens, cacheCreationInputTokens: conv.cacheCreationInputTokens,
        };
      }
      return formatTokenCount(calculateBillableTokens(usage, weights));
    },
  },

  actions: {
    // ==================== SESSION LIST HELPERS ====================

    _updateSessionInAllLists(sessionId, updates) {
      const updateInArray = (arr, index) => {
        if (index !== -1) arr[index] = { ...arr[index], ...updates };
      };
      updateInArray(this.sessions, this.sessions.findIndex(s => s.id === sessionId));
      updateInArray(this.archivedSessions, this.archivedSessions.findIndex(s => s.id === sessionId));
      updateInArray(this.activeSessions, this.activeSessions.findIndex(s => s.id === sessionId));
      if (this.currentSession?.id === sessionId) {
        this.currentSession = { ...this.currentSession, ...updates };
      }
    },

    // ==================== SESSION FETCH ACTIONS ====================

    async fetchActiveSessions(showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try { this.activeSessions = await api.getActiveSessions(); }
      catch (err) { this.error = err.message; }
      finally { if (showLoading) this.loading = false; }
    },

    async fetchScheduledSessions(projectId = null) {
      this.loadingScheduled = true;
      this.error = null;
      try {
        const sessions = await api.getScheduledSessions(projectId);
        this.scheduledSessions = sessions.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
      } catch (err) {
        this.error = err.message;
        console.error('Failed to fetch scheduled sessions:', err);
      } finally { this.loadingScheduled = false; }
    },

    async fetchSessions(projectId) {
      this.loading = true;
      this.error = null;
      try { this.sessions = await api.getProjectSessions(projectId, false, null); }
      catch (err) { this.error = err.message; }
      finally { this.loading = false; }
    },

    async fetchArchivedSessions(projectId, { reset = true } = {}) {
      const PAGE_SIZE = 25;
      if (reset) { this.archivedSessions = []; this.archivedPagination.offset = 0; }
      this.archivedPagination.loading = true;
      this.error = null;
      try {
        const response = await api.getProjectSessions(
          projectId, true, this.starredFilter, { limit: PAGE_SIZE, offset: this.archivedPagination.offset }
        );
        this.archivedSessions = reset ? response.sessions : [...this.archivedSessions, ...response.sessions];
        this.archivedPagination = {
          total: response.pagination.total,
          offset: this.archivedPagination.offset + response.sessions.length,
          hasMore: response.pagination.hasMore, loading: false,
        };
      } catch (err) { this.error = err.message; this.archivedPagination.loading = false; }
    },

    async loadMoreArchivedSessions(projectId) {
      if (this.archivedPagination.hasMore && !this.archivedPagination.loading) {
        await this.fetchArchivedSessions(projectId, { reset: false });
      }
    },

    async fetchSession(id, showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.currentSession = await api.getSession(id);
        if (this.currentSession?.parentSessionId) {
          let parentId = this.currentSession.parentSessionId;
          while (parentId) {
            const existingParent = this.sessions.find((s) => s.id === parentId);
            if (existingParent) { parentId = existingParent.parentSessionId; continue; }
            try {
              const parentSession = await api.getSession(parentId);
              this.sessions.push(parentSession);
              parentId = parentSession.parentSessionId;
            } catch (error) { console.error('Failed to fetch parent session:', error); break; }
          }
        }
        if (this.currentSession?.projectId) {
          try {
            const projectSessions = await api.getProjectSessions(this.currentSession.projectId);
            const childSessions = projectSessions.filter(s => s.parentSessionId === id);
            for (const child of childSessions) {
              if (!this.sessions.find(s => s.id === child.id)) this.sessions.push(child);
            }
          } catch (error) { console.error('Failed to fetch child sessions:', error); }
        }
      } catch (err) { this.error = err.message; }
      finally { if (showLoading) this.loading = false; }
    },

    // ==================== SESSION CRUD ACTIONS ====================

    async createSession(projectId, data) {
      this.loading = true;
      this.error = null;
      try {
        const session = await api.createSession(projectId, data);
        this.sessions.unshift(session);
        return session;
      } catch (err) { this.error = err.message; throw err; }
      finally { this.loading = false; }
    },

    async sendMessage(sessionId, content, files = [], model = null) {
      this.error = null;
      try {
        await api.sendMessage(sessionId, content, files, model);
        this._updateSessionInAllLists(sessionId, { status: 'running' });
      } catch (err) { this.error = err.message; throw err; }
    },

    async stopSession(id) {
      this.error = null;
      try { await api.stopSession(id); this._updateSessionInAllLists(id, { status: 'stopped' }); }
      catch (err) { this.error = err.message; throw err; }
    },

    async restartSession(id) {
      this.error = null;
      try { await api.restartSession(id); this._updateSessionInAllLists(id, { status: 'stopped', error: null }); }
      catch (err) { this.error = err.message; throw err; }
    },

    async startSession(id, prompt = undefined, model = undefined) {
      this.error = null;
      try {
        const result = await api.startSession(id, prompt, model);
        this._updateSessionInAllLists(id, { status: 'starting' });
        return result;
      } catch (err) { this.error = err.message; throw err; }
    },

    async deleteSession(id) {
      this.error = null;
      try {
        await api.deleteSession(id);
        this.sessions = this.sessions.filter((s) => s.id !== id);
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
        if (this.currentSession?.id === id) this.currentSession = null;
      } catch (err) { this.error = err.message; throw err; }
    },

    async archiveSession(id) {
      this.error = null;
      try {
        const updated = await api.archiveSession(id);
        this.sessions = this.sessions.filter((s) => s.id !== id);
        this.archivedSessions.unshift(updated);
        this.activeSessions = this.activeSessions.filter((s) => s.id !== id);
        if (this.currentSession?.id === id) this.currentSession = { ...this.currentSession, archived: true };
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    async unarchiveSession(id) {
      this.error = null;
      try {
        const updated = await api.unarchiveSession(id);
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
        this.sessions.unshift(updated);
        if (this.currentSession?.id === id) this.currentSession = { ...this.currentSession, archived: false };
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    async duplicateSession(id, options = {}) {
      this.error = null;
      try { return await api.duplicateSession(id, options); }
      catch (err) { this.error = err.message; throw err; }
    },

    async toggleSessionStar(sessionId) {
      this.error = null;
      try {
        const updated = await api.toggleSessionStar(sessionId);
        this._updateSessionInAllLists(sessionId, { starred: updated.starred });
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    updateSessionStatus(sessionId, status) {
      const session = this.sessions.find(s => s.id === sessionId) || this.currentSession;
      const wasRunning = session?.status === 'running';
      const updates = { status };
      if (wasRunning && (status === 'waiting' || status === 'completed')) updates.hasResponses = true;
      this._updateSessionInAllLists(sessionId, updates);
    },

    async updateSessionThinking(sessionId, thinkingEnabled) {
      return this.updateSessionFields(sessionId, { thinkingEnabled });
    },

    async updateSessionMode(sessionId, mode) {
      return this.updateSessionFields(sessionId, { mode });
    },

    async updateSessionModel(sessionId, model, providerId = undefined) {
      this.error = null;
      try {
        const updateData = { model };
        if (providerId !== undefined) updateData.providerId = providerId;
        const updated = await api.updateSession(sessionId, updateData);
        this._updateSessionInAllLists(sessionId, updateData);
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    async updateNextTemplate(sessionId, nextTemplateId) {
      return this.updateSessionFields(sessionId, { nextTemplateId });
    },

    async updateSessionFields(sessionId, updates) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, updates);
        this._updateSessionInAllLists(sessionId, updates);
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    updateSession(sessionData) {
      if (!sessionData?.id) return;
      if (sessionData.archived === true) {
        const existingSession = this.sessions.find(s => s.id === sessionData.id);
        const existingSessionCopy = existingSession ? { ...existingSession } : null;
        this.sessions = this.sessions.filter((s) => s.id !== sessionData.id);
        this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionData.id);
        const archivedIndex = this.archivedSessions.findIndex((s) => s.id === sessionData.id);
        if (archivedIndex !== -1) {
          this.archivedSessions[archivedIndex] = { ...this.archivedSessions[archivedIndex], ...sessionData };
        } else {
          this.archivedSessions.unshift(existingSessionCopy ? { ...existingSessionCopy, ...sessionData } : sessionData);
        }
      } else if (sessionData.archived === false) {
        const existingSession = this.archivedSessions.find(s => s.id === sessionData.id);
        const existingSessionCopy = existingSession ? { ...existingSession } : null;
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionData.id);
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        } else {
          this.sessions.unshift(existingSessionCopy ? { ...existingSessionCopy, ...sessionData } : sessionData);
        }
      } else {
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        const archivedIndex = this.archivedSessions.findIndex((s) => s.id === sessionData.id);
        if (archivedIndex !== -1) this.archivedSessions[archivedIndex] = { ...this.archivedSessions[archivedIndex], ...sessionData };
      }
      if (this.currentSession?.id === sessionData.id) this.currentSession = { ...this.currentSession, ...sessionData };
      const activeIndex = this.activeSessions.findIndex((s) => s.id === sessionData.id);
      if (activeIndex !== -1) this.activeSessions[activeIndex] = { ...this.activeSessions[activeIndex], ...sessionData };
      if (sessionData.status === 'scheduled') {
        const scheduledIndex = this.scheduledSessions.findIndex((s) => s.id === sessionData.id);
        if (scheduledIndex === -1) this.scheduledSessions.push(sessionData);
        else this.scheduledSessions[scheduledIndex] = { ...this.scheduledSessions[scheduledIndex], ...sessionData };
        this.scheduledSessions.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
      } else {
        this.scheduledSessions = this.scheduledSessions.filter((s) => s.id !== sessionData.id);
      }
    },

    addSessionToList(session) {
      if (!session?.id) return;
      if (!this.sessions.some((s) => s.id === session.id)) this.sessions.unshift(session);
      if (['running', 'waiting', 'starting'].includes(session.status)) {
        if (!this.activeSessions.some((s) => s.id === session.id)) this.activeSessions.unshift(session);
      }
    },

    removeSessionFromList(sessionId) {
      if (!sessionId) return;
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);
      this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionId);
      this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionId);
      if (this.currentSession?.id === sessionId) this.currentSession = null;
    },

    // ==================== EXPANDED STATE ====================

    toggleSessionExpanded(sessionId) {
      if (this.expandedSessions.has(sessionId)) this.expandedSessions.delete(sessionId);
      else this.expandedSessions.add(sessionId);
    },

    saveExpandedState() {
      try { localStorage.setItem('expandedSessions', JSON.stringify(Array.from(this.expandedSessions))); }
      catch (error) { console.warn('Failed to save expanded sessions state:', error); }
    },

    restoreExpandedState() {
      try {
        const expanded = localStorage.getItem('expandedSessions');
        if (expanded) this.expandedSessions = new Set(JSON.parse(expanded));
      } catch (error) {
        console.warn('Failed to restore expanded sessions state:', error);
        this.expandedSessions = new Set();
      }
    },

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

    // ==================== MESSAGE ACTIONS ====================

    async fetchMessages(sessionId, showLoading = true, conversationId = null) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        const cid = conversationId || this.activeConversationId;
        const fetchedMessages = cid
          ? await api.getConversationMessages(sessionId, cid)
          : await api.getSessionMessages(sessionId);
        console.log(`[STORE] fetchMessages: session ${sessionId}, conversationId: ${cid || 'none'}, received ${fetchedMessages.length} messages, activeConversationId: ${this.activeConversationId}`);
        const fetchedIds = new Set(fetchedMessages.map(m => m.id));
        const newMessages = this.messages.filter(m => m.sessionId === sessionId && !fetchedIds.has(m.id));
        if (newMessages.length > 0) {
          console.log(`[STORE] fetchMessages: merging ${fetchedMessages.length} fetched + ${newMessages.length} WebSocket-delivered messages`);
          this.messages = [...fetchedMessages, ...newMessages];
        } else {
          this.messages = fetchedMessages;
        }
        console.log(`[STORE] fetchMessages: updated store with ${this.messages.length} messages`);
      } catch (err) {
        this.error = err.message;
        console.error(`[STORE] fetchMessages: error fetching messages for session ${sessionId}:`, err.message);
      } finally { if (showLoading) this.loading = false; }
    },

    addMessage(message) {
      if (this.currentSession && message.sessionId && message.sessionId !== this.currentSession.id) return;
      if (!this.messages.some(m => m.id === message.id)) this.messages.push(message);
    },

    // ==================== WORK LOG ACTIONS ====================

    async fetchWorkLogs(sessionId) {
      this.error = null;
      try {
        const grouped = await api.getSessionWorkLogs(sessionId);
        const fetchedLogIds = new Set();
        for (const messageId of Object.keys(grouped)) {
          for (const log of grouped[messageId] || []) fetchedLogIds.add(log.id);
        }
        const existingUnassociated = this.workLogs['_unassociated'] || [];
        const newUnassociatedLogs = existingUnassociated.filter(log => !fetchedLogIds.has(log.id));
        const fetchedUnassociated = grouped['_unassociated'] || [];
        this.workLogs = { ...grouped, '_unassociated': [...fetchedUnassociated, ...newUnassociatedLogs] };
      } catch (err) { this.error = err.message; }
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

    // ==================== STREAMING ACTIONS (delegate to streaming store) ====================

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

    // ==================== CONVERSATION ACTIONS ====================

    async fetchConversations(sessionId) {
      this.error = null;
      try {
        this.conversations = await api.getConversations(sessionId);
        const active = this.conversations.find((c) => c.isActive);
        this.activeConversationId = active?.id || this.conversations[0]?.id || null;
      } catch (err) {
        this.error = err.message;
        this.conversations = [];
        this.activeConversationId = null;
      }
    },

    async createConversation(sessionId, name = null) {
      this.error = null;
      try {
        const conversation = await api.createConversation(sessionId, name);
        this.conversations.push(conversation);
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === conversation.id }));
        this.activeConversationId = conversation.id;
        this.messages = [];
        this.runningUsage = null;
        return conversation;
      } catch (err) { this.error = err.message; throw err; }
    },

    async switchConversation(sessionId, conversationId) {
      if (this.activeConversationId === conversationId) return;
      this.error = null;
      try {
        this.runningUsage = null;
        this.clearPartialThinking();
        this.messages = [];
        this.workLogs = {};
        await api.updateConversation(sessionId, conversationId, { isActive: true });
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === conversationId }));
        this.activeConversationId = conversationId;
        this.messages = await api.getConversationMessages(sessionId, conversationId);
        this.clearPartialThinking(sessionId);
        await this.fetchWorkLogs(sessionId);
      } catch (err) { this.error = err.message; throw err; }
    },

    async renameConversation(sessionId, conversationId, name) {
      this.error = null;
      try {
        const updated = await api.updateConversation(sessionId, conversationId, { name });
        const index = this.conversations.findIndex((c) => c.id === conversationId);
        if (index !== -1) this.conversations[index] = { ...this.conversations[index], ...updated };
        return updated;
      } catch (err) { this.error = err.message; throw err; }
    },

    async deleteConversation(sessionId, conversationId) {
      this.error = null;
      try {
        await api.deleteConversation(sessionId, conversationId);
        this.conversations = this.conversations.filter((c) => c.id !== conversationId);
        if (this.activeConversationId === conversationId) {
          if (this.conversations.length > 0) {
            await this.fetchConversations(sessionId);
            if (this.activeConversationId) {
              this.messages = await api.getConversationMessages(sessionId, this.activeConversationId);
            }
          } else { this.activeConversationId = null; this.messages = []; }
        }
      } catch (err) { this.error = err.message; throw err; }
    },

    async branchConversation(sessionId, conversationId, messageId, name = null, prompt = null) {
      this.error = null;
      try {
        const branchConversation = await api.branchConversation(sessionId, conversationId, { messageId, prompt });
        if (!this.conversations.some((c) => c.id === branchConversation.id)) this.conversations.push(branchConversation);
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === branchConversation.id }));
        this.activeConversationId = branchConversation.id;
        this.messages = [];
        this.workLogs = {};
        this.clearPartialThinking(sessionId);
        Promise.all([
          api.getConversationMessages(sessionId, branchConversation.id)
            .then(messages => { if (this.activeConversationId === branchConversation.id) this.messages = messages; })
            .catch(err => console.error('Failed to fetch messages for branch:', err)),
          this.fetchWorkLogs(sessionId).catch(err => console.error('Failed to fetch work logs for branch:', err))
        ]);
        return branchConversation;
      } catch (err) { this.error = err.message; throw err; }
    },

    updateConversation(conversation) {
      if (!conversation?.id) return;
      if (this.currentSession && conversation.sessionId && conversation.sessionId !== this.currentSession.id) return;
      const index = this.conversations.findIndex((c) => c.id === conversation.id);
      if (index !== -1) this.conversations.splice(index, 1, { ...this.conversations[index], ...conversation });
      if (conversation.isActive) {
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === conversation.id }));
        this.activeConversationId = conversation.id;
      }
    },

    addConversation(conversation) {
      if (!conversation?.id) return;
      if (this.currentSession && conversation.sessionId && conversation.sessionId !== this.currentSession.id) return;
      if (!this.conversations.some((c) => c.id === conversation.id)) this.conversations.push(conversation);
      if (conversation.isActive) {
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === conversation.id }));
        this.activeConversationId = conversation.id;
      }
    },

    removeConversation(conversationId, newActiveConversation = null, sessionId = null) {
      if (this.currentSession && sessionId && sessionId !== this.currentSession.id) return;
      this.conversations = this.conversations.filter((c) => c.id !== conversationId);
      if (newActiveConversation) {
        if (!this.conversations.some((c) => c.id === newActiveConversation.id)) this.conversations.push(newActiveConversation);
        this.conversations = this.conversations.map((c) => ({ ...c, isActive: c.id === newActiveConversation.id }));
        this.activeConversationId = newActiveConversation.id;
      } else if (this.activeConversationId === conversationId) {
        this.activeConversationId = this.conversations[0]?.id || null;
      }
    },

    clearConversations() { this.conversations = []; this.activeConversationId = null; },
  },
});
