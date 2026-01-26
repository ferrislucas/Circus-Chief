import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { calculateBillableTokens, formatTokenCount } from '@claudetools/shared';
import { useSettingsStore } from './settings.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
    archivedSessions: [],
    activeSessions: [],
    scheduledSessions: [],
    currentSession: null,
    messages: [],
    conversations: [], // All conversations for current session
    activeConversationId: null, // Currently selected conversation ID
    workLogs: {}, // Keyed by messageId: { [messageId]: WorkLog[] }
    partialThinking: null, // Current streaming thinking content
    expandedSessions: new Set(), // Track which parent sessions are expanded
    statusFilter: null, // 'running' | 'idle' | null (null = show all)
    starredFilter: null, // 'starred' | 'unstarred' | null (null = show all)
    scheduledFilter: null, // 'scheduled' | 'not-scheduled' | null (null = show all)
    runningUsage: null, // Partial usage during a turn
    loading: false,
    loadingScheduled: false,
    error: null,
    // Version counter for command run updates - used to force Vue reactivity
    // in computed properties that depend on latestCommandRuns
    commandRunVersion: 0,
    // Pagination state for archived sessions
    archivedPagination: {
      total: 0,
      offset: 0,
      hasMore: false,
      loading: false,
    },
  }),

  getters: {
    getSessionById: (state) => (id) => {
      return state.sessions.find((s) => s.id === id);
    },
    getWorkLogsForMessage: (state) => (messageId) => {
      return state.workLogs[messageId] || [];
    },
    getUnassociatedWorkLogs: (state) => {
      return state.workLogs['_unassociated'] || [];
    },
    activeConversation: (state) => {
      return state.conversations.find((c) => c.id === state.activeConversationId) || null;
    },
    getConversationById: (state) => (id) => {
      return state.conversations.find((c) => c.id === id);
    },

    // Conversation tree getters (for branching feature)
    rootConversations: (state) => {
      return state.conversations.filter((c) => !c.parentConversationId);
    },

    conversationTree: (state) => {
      // Build a tree structure from flat conversations list
      const buildTree = (parentId = null) => {
        return state.conversations
          .filter((c) => c.parentConversationId === parentId)
          .map((conv) => ({
            ...conv,
            children: buildTree(conv.id),
          }));
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

    /**
     * Get all descendants of a session (children, grandchildren, etc.)
     * @param {string} sessionId - The session ID
     * @returns {Array} All descendant sessions
     */
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

    /**
     * Get the effective status for a workflow (root session + all descendants)
     * @param {string} rootSessionId - The root session ID
     * @returns {'running' | 'idle'} The effective status for filtering
     */
    getWorkflowEffectiveStatus: (state) => (rootSessionId) => {
      // Get the root session
      const root = state.sessions.find((s) => s.id === rootSessionId);
      if (!root) return 'idle';

      // Get all descendants
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

      // Check if any session in the workflow is running
      const runningStatuses = ['running', 'starting'];
      const hasRunning = allSessions.some((s) => runningStatuses.includes(s.status));

      return hasRunning ? 'running' : 'idle';
    },

    /**
     * Get the path from root to a specific session (for breadcrumbs)
     * @param {string} sessionId - The session ID
     * @returns {Array} Array of sessions from root to this session
     */
    getSessionPath: (state) => (sessionId) => {
      const path = [];

      // Helper to find a session in either sessions array or currentSession
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

    /**
     * Get the root session for a given session
     * @param {string} sessionId - The session ID
     * @returns {Object|null} The root session
     */
    getRootSession: (state) => (sessionId) => {
      let current = state.sessions.find((s) => s.id === sessionId);
      while (current?.parentSessionId) {
        current = state.sessions.find((s) => s.id === current.parentSessionId);
      }
      return current || null;
    },

    /**
     * Get aggregated workflow status for display and filtering
     * @param {string} rootSessionId - The root session ID
     * @returns {Object} Aggregated status info
     */
    getWorkflowAggregatedStatus: (state) => (rootSessionId) => {
      // Get the root session
      const root = state.sessions.find((s) => s.id === rootSessionId);
      if (!root) {
        return {
          effectiveStatus: 'idle',
          runningCount: 0,
          scheduledCount: 0,
          waitingCount: 0,
          completedCount: 0,
          errorCount: 0,
          totalCount: 0,
          hasScheduledDescendant: false,
          rootIsScheduled: false,
        };
      }

      // Get all sessions in the workflow
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

      // Count statuses
      const runningStatuses = ['running', 'starting'];
      let runningCount = 0;
      let scheduledCount = 0;
      let waitingCount = 0;
      let completedCount = 0;
      let errorCount = 0;

      for (const session of allSessions) {
        if (runningStatuses.includes(session.status)) {
          runningCount++;
        } else if (session.status === 'scheduled') {
          scheduledCount++;
        } else if (session.status === 'waiting') {
          waitingCount++;
        } else if (session.status === 'completed' || session.status === 'stopped') {
          completedCount++;
        } else if (session.status === 'error') {
          errorCount++;
        }
      }

      const hasRunning = runningCount > 0;

      return {
        effectiveStatus: hasRunning ? 'running' : 'idle',
        runningCount,
        scheduledCount,
        waitingCount,
        completedCount,
        errorCount,
        totalCount: allSessions.length,
        hasScheduledDescendant: allSessions.slice(1).some((s) => s.status === 'scheduled'),
        rootIsScheduled: root.status === 'scheduled',
      };
    },

    // Group sessions by parent for hierarchical display
    groupedSessions: (state) => {
      const grouped = [];
      const seen = new Set();

      // First pass: add all parent sessions with their children
      state.sessions.forEach((session) => {
        if (!session.parentSessionId && !seen.has(session.id)) {
          grouped.push({
            parent: session,
            children: state.sessions.filter((s) => s.parentSessionId === session.id),
          });
          seen.add(session.id);
        }
      });

      // Second pass: add standalone sessions (no parent, no children)
      state.sessions.forEach((session) => {
        if (!session.parentSessionId && !grouped.find((g) => g.parent.id === session.id)) {
          grouped.push({
            parent: session,
            children: [],
          });
        }
      });

      return grouped;
    },

    isDraftSession: (state) => (session) => {
      // A session is a draft if it's in waiting status and has never received any assistant responses
      // We use session.hasResponses (from server) as the authoritative source since it checks
      // all messages across all conversations, not just the currently loaded conversation
      if (!session || session.status !== 'waiting') return false;
      // If hasResponses is available (from server), use it; otherwise fall back to checking loaded messages
      if (session.hasResponses !== undefined) {
        return !session.hasResponses;
      }
      return !state.messages.some((msg) => msg.role === 'assistant');
    },
    isScheduledDraft: (state) => (session) => {
      // A session is a scheduled draft if it's scheduled and has never received any assistant responses
      // This means the user can still edit the prompt before it starts
      if (!session || session.status !== 'scheduled') return false;
      // If hasResponses is available (from server), use it; otherwise fall back to checking loaded messages
      if (session.hasResponses !== undefined) {
        return !session.hasResponses;
      }
      return !state.messages.some((msg) => msg.role === 'assistant');
    },
    // Token usage getters - now conversation-level (Issue #175)
    conversationTokens: (state) => {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      return conv
        ? {
            inputTokens: conv.inputTokens || 0,
            outputTokens: conv.outputTokens || 0,
            cacheReadInputTokens: conv.cacheReadInputTokens || 0,
            cacheCreationInputTokens: conv.cacheCreationInputTokens || 0,
            webSearchRequests: conv.webSearchRequests || 0,
            contextWindow: conv.contextWindow || 200000,
            model: conv.model,
          }
        : null;
    },
    totalTokens: (state) => {
      // Use active conversation tokens if available, fallback to session
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (conv) {
        return (conv.inputTokens || 0) + (conv.outputTokens || 0);
      }
      const session = state.currentSession;
      if (!session) return 0;
      return (session.inputTokens || 0) + (session.outputTokens || 0);
    },
    formattedTokens: (state) => {
      const format = (n) => {
        if (n === null || n === undefined) return '-';
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
      };

      // STREAMING: During active turn, show turn usage + conversation base
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                           state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          // Get conversation's existing tokens (from previous turns)
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const baseInput = conv?.inputTokens || 0;
          const baseOutput = conv?.outputTokens || 0;

          // Add current turn's streaming usage
          const totalInput = baseInput + (state.runningUsage.inputTokens || 0);
          const totalOutput = baseOutput + (state.runningUsage.outputTokens || 0);

          return {
            input: format(totalInput),
            output: format(totalOutput),
            total: format(totalInput + totalOutput),
            cacheRead: format((conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0)),
            cacheCreation: format((conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0)),
          };
        }
      }

      // PERSISTED: Show conversation totals
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (conv) {
          return {
            input: format(conv.inputTokens),
            output: format(conv.outputTokens),
            total: format((conv.inputTokens || 0) + (conv.outputTokens || 0)),
            cacheRead: format(conv.cacheReadInputTokens),
            cacheCreation: format(conv.cacheCreationInputTokens),
          };
        }
      }

      // FALLBACK: Show dashes instead of zeros (indicates "not loaded")
      return { input: '-', output: '-', total: '-', cacheRead: '-', cacheCreation: '-' };
    },
    contextPercentage: (state) => {
      // STREAMING: Use running usage + base conversation tokens (same logic as formattedTokens)
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          // Get conversation's base tokens (from previous turns)
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const baseInput = conv?.inputTokens || 0;
          const baseOutput = conv?.outputTokens || 0;
          const baseContextWindow = conv?.contextWindow || 200000;

          // Add running usage to base (same as formattedTokens)
          const totalInput = baseInput + (state.runningUsage.inputTokens || 0);
          const totalOutput = baseOutput + (state.runningUsage.outputTokens || 0);
          const total = totalInput + totalOutput;
          const contextWindow = state.runningUsage.contextWindow || baseContextWindow;
          return Math.min(100, Math.round((total / contextWindow) * 100));
        }
      }

      // PERSISTED: Use conversation totals
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      const source = conv || state.currentSession;
      if (!source) return 0;

      const totalTokens = (source.inputTokens || 0) + (source.outputTokens || 0);
      const contextWindow = source.contextWindow || 200000;
      return Math.min(100, Math.round((totalTokens / contextWindow) * 100));
    },
    isUsageUpdating: (state) => {
      // Only show updating indicator if runningUsage is for current conversation
      if (!state.runningUsage) return false;
      // If there's an active conversation, only show if runningUsage is for that conversation
      if (state.activeConversationId && state.runningUsage.conversationId !== state.activeConversationId) {
        return false;
      }
      return true;
    },

    /**
     * Get tokens for a specific conversation, considering runningUsage if active
     * Used by ConversationSelector to show real-time token updates in dropdown
     *
     * During streaming: Returns base conversation tokens + current turn's running usage
     * After completion: Returns base conversation tokens only
     * This matches the logic in formattedTokens for consistency
     */
    getConversationDisplayTokens: (state) => (conversationId) => {
      // Find the conversation first (needed for both cases)
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) return { inputTokens: 0, outputTokens: 0, total: 0 };

      // If this conversation has active runningUsage, add it to base tokens
      if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
        const baseInput = conv.inputTokens || 0;
        const baseOutput = conv.outputTokens || 0;
        const totalInput = baseInput + (state.runningUsage.inputTokens || 0);
        const totalOutput = baseOutput + (state.runningUsage.outputTokens || 0);

        return {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          total: totalInput + totalOutput,
        };
      }

      // Otherwise use stored conversation data
      return {
        inputTokens: conv.inputTokens || 0,
        outputTokens: conv.outputTokens || 0,
        total: (conv.inputTokens || 0) + (conv.outputTokens || 0),
      };
    },

    /**
     * Calculate Billable Token Equivalent (BTE) for current conversation
     * Uses configurable weights from settings store
     * Supports real-time updates during streaming
     */
    billableTokens: (state) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;

      // STREAMING: During active turn, use turn usage + conversation base
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const usage = {
            inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
            outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
            cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
            cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
          };
          return calculateBillableTokens(usage, weights);
        }
      }

      // PERSISTED: Use conversation totals
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (conv) {
          return calculateBillableTokens({
            inputTokens: conv.inputTokens,
            outputTokens: conv.outputTokens,
            cacheReadInputTokens: conv.cacheReadInputTokens,
            cacheCreationInputTokens: conv.cacheCreationInputTokens,
          }, weights);
        }
      }

      // FALLBACK: No data
      return 0;
    },

    /**
     * Get formatted BTE string for display (e.g., "87.5K")
     */
    formattedBillableTokens: (state) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;

      // STREAMING: During active turn, use turn usage + conversation base
      if (state.runningUsage) {
        const isRelevant = !state.activeConversationId ||
                          state.runningUsage.conversationId === state.activeConversationId;
        if (isRelevant) {
          const conv = state.conversations.find(c => c.id === state.activeConversationId);
          const usage = {
            inputTokens: (conv?.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
            outputTokens: (conv?.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
            cacheReadInputTokens: (conv?.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
            cacheCreationInputTokens: (conv?.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
          };
          const bte = calculateBillableTokens(usage, weights);
          return formatTokenCount(bte);
        }
      }

      // PERSISTED: Use conversation totals
      if (state.activeConversationId && state.conversations.length > 0) {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (conv) {
          const bte = calculateBillableTokens({
            inputTokens: conv.inputTokens,
            outputTokens: conv.outputTokens,
            cacheReadInputTokens: conv.cacheReadInputTokens,
            cacheCreationInputTokens: conv.cacheCreationInputTokens,
          }, weights);
          return formatTokenCount(bte);
        }
      }

      // FALLBACK: No data
      return '-';
    },

    /**
     * Calculate BTE for a specific conversation
     * Used by ConversationSelector and ConversationTreeItem
     */
    getConversationBillableTokens: (state) => (conversationId) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;

      const conv = state.conversations.find(c => c.id === conversationId);
      if (!conv) return 0;

      // If this conversation has active runningUsage, include it
      if (state.runningUsage && state.runningUsage.conversationId === conversationId) {
        const usage = {
          inputTokens: (conv.inputTokens || 0) + (state.runningUsage.inputTokens || 0),
          outputTokens: (conv.outputTokens || 0) + (state.runningUsage.outputTokens || 0),
          cacheReadInputTokens: (conv.cacheReadInputTokens || 0) + (state.runningUsage.cacheReadInputTokens || 0),
          cacheCreationInputTokens: (conv.cacheCreationInputTokens || 0) + (state.runningUsage.cacheCreationInputTokens || 0),
        };
        return calculateBillableTokens(usage, weights);
      }

      // Use stored conversation data
      return calculateBillableTokens({
        inputTokens: conv.inputTokens,
        outputTokens: conv.outputTokens,
        cacheReadInputTokens: conv.cacheReadInputTokens,
        cacheCreationInputTokens: conv.cacheCreationInputTokens,
      }, weights);
    },

    /**
     * Get formatted BTE for a specific conversation
     */
    getFormattedConversationBillableTokens: (state) => (conversationId) => {
      const settingsStore = useSettingsStore();
      const weights = settingsStore.tokenCostWeights;

      const conv = state.conversations.find(c => c.id === conversationId);
      if (!conv) return '-';

      // If this conversation has active runningUsage, include it
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
          inputTokens: conv.inputTokens,
          outputTokens: conv.outputTokens,
          cacheReadInputTokens: conv.cacheReadInputTokens,
          cacheCreationInputTokens: conv.cacheCreationInputTokens,
        };
      }

      const bte = calculateBillableTokens(usage, weights);
      return formatTokenCount(bte);
    },
  },

  actions: {
    async fetchActiveSessions(showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.activeSessions = await api.getActiveSessions();
      } catch (err) {
        this.error = err.message;
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async fetchScheduledSessions(projectId = null) {
      this.loadingScheduled = true;
      this.error = null;
      try {
        const sessions = await api.getScheduledSessions(projectId);
        // Sort by scheduledAt (earliest first)
        this.scheduledSessions = sessions.sort((a, b) =>
          new Date(a.scheduledAt) - new Date(b.scheduledAt)
        );
      } catch (err) {
        this.error = err.message;
        console.error('Failed to fetch scheduled sessions:', err);
      } finally {
        this.loadingScheduled = false;
      }
    },

    async fetchSessions(projectId) {
      this.loading = true;
      this.error = null;
      try {
        this.sessions = await api.getProjectSessions(projectId, false, this.starredFilter);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchArchivedSessions(projectId, { reset = true } = {}) {
      const PAGE_SIZE = 25;

      if (reset) {
        this.archivedSessions = [];
        this.archivedPagination.offset = 0;
      }

      this.archivedPagination.loading = true;
      this.error = null;

      try {
        const response = await api.getProjectSessions(
          projectId,
          true, // archived
          this.starredFilter,
          { limit: PAGE_SIZE, offset: this.archivedPagination.offset }
        );

        if (reset) {
          this.archivedSessions = response.sessions;
        } else {
          this.archivedSessions = [...this.archivedSessions, ...response.sessions];
        }

        this.archivedPagination = {
          total: response.pagination.total,
          offset: this.archivedPagination.offset + response.sessions.length,
          hasMore: response.pagination.hasMore,
          loading: false,
        };
      } catch (err) {
        this.error = err.message;
        this.archivedPagination.loading = false;
      }
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

        // Also fetch parent and child sessions for navigation
        // This ensures related sessions are available in the store

        // Fetch parent sessions for breadcrumb navigation
        if (this.currentSession?.parentSessionId) {
          let parentId = this.currentSession.parentSessionId;
          while (parentId) {
            // Check if parent is already in sessions array
            const existingParent = this.sessions.find((s) => s.id === parentId);
            if (existingParent) {
              parentId = existingParent.parentSessionId;
              continue;
            }

            // Fetch parent session and add to sessions array
            try {
              const parentSession = await api.getSession(parentId);
              this.sessions.push(parentSession);
              parentId = parentSession.parentSessionId;
            } catch (error) {
              console.error('Failed to fetch parent session:', error);
              break;
            }
          }
        }

        // Fetch child sessions for child sessions panel
        // Get all sessions for the project to find children
        if (this.currentSession?.projectId) {
          try {
            const projectSessions = await api.getProjectSessions(this.currentSession.projectId);
            // Add any child sessions that aren't already in the store
            const childSessions = projectSessions.filter(s => s.parentSessionId === id);
            for (const child of childSessions) {
              if (!this.sessions.find(s => s.id === child.id)) {
                this.sessions.push(child);
              }
            }
          } catch (error) {
            console.error('Failed to fetch child sessions:', error);
          }
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async fetchMessages(sessionId, showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        const fetchedMessages = await api.getSessionMessages(sessionId);
        console.log(`[STORE] fetchMessages: session ${sessionId}, received ${fetchedMessages.length} messages, activeConversationId: ${this.activeConversationId}`);

        // Smart merge: preserve any messages that were added via WebSocket but not yet in API response
        // This prevents a race condition where WebSocket delivers a message before the server has
        // persisted it, causing fetchMessages to overwrite the store with stale data
        const fetchedIds = new Set(fetchedMessages.map(m => m.id));
        const newMessages = this.messages.filter(m =>
          m.sessionId === sessionId && !fetchedIds.has(m.id)
        );

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
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async createSession(projectId, data) {
      this.loading = true;
      this.error = null;
      try {
        const session = await api.createSession(projectId, data);
        this.sessions.unshift(session);
        return session;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async sendMessage(sessionId, content, files = [], model = null) {
      this.error = null;
      try {
        await api.sendMessage(sessionId, content, files, model);
        // Optimistically update status to 'running' immediately after send succeeds
        // This ensures the UI shows "Claude is working..." without waiting for WebSocket
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.status = 'running';
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession.status = 'running';
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async stopSession(id) {
      this.error = null;
      try {
        await api.stopSession(id);
        if (this.currentSession?.id === id) {
          this.currentSession.status = 'stopped';
        }
        const session = this.sessions.find((s) => s.id === id);
        if (session) {
          session.status = 'stopped';
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async restartSession(id) {
      this.error = null;
      try {
        await api.restartSession(id);
        if (this.currentSession?.id === id) {
          this.currentSession.status = 'stopped';
          this.currentSession.error = null;
        }
        const session = this.sessions.find((s) => s.id === id);
        if (session) {
          session.status = 'stopped';
          session.error = null;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async startSession(id, prompt = undefined) {
      this.error = null;
      try {
        const result = await api.startSession(id, prompt);
        // Update session status to starting
        if (this.currentSession?.id === id) {
          this.currentSession.status = 'starting';
        }
        const session = this.sessions.find((s) => s.id === id);
        if (session) {
          session.status = 'starting';
        }
        return result;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async deleteSession(id) {
      this.error = null;
      try {
        await api.deleteSession(id);
        // Remove session from list
        this.sessions = this.sessions.filter((s) => s.id !== id);
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
        // Clear current session if it's the deleted one
        if (this.currentSession?.id === id) {
          this.currentSession = null;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async archiveSession(id) {
      this.error = null;
      try {
        const updated = await api.archiveSession(id);
        // Move from sessions to archivedSessions
        this.sessions = this.sessions.filter((s) => s.id !== id);
        this.archivedSessions.unshift(updated);
        // Also remove from activeSessions if present
        this.activeSessions = this.activeSessions.filter((s) => s.id !== id);
        // Update current session if it matches
        if (this.currentSession?.id === id) {
          this.currentSession = { ...this.currentSession, archived: true };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async unarchiveSession(id) {
      this.error = null;
      try {
        const updated = await api.unarchiveSession(id);
        // Move from archivedSessions to sessions
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
        this.sessions.unshift(updated);
        // Update current session if it matches
        if (this.currentSession?.id === id) {
          this.currentSession = { ...this.currentSession, archived: false };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async duplicateSession(id, options = {}) {
      this.error = null;
      try {
        const newSession = await api.duplicateSession(id, options);
        // New session will be added via WebSocket, but return it immediately for UI feedback
        return newSession;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async toggleSessionStar(sessionId) {
      this.error = null;
      try {
        const updated = await api.toggleSessionStar(sessionId);

        // Update all session arrays
        const updateInArray = (arr) => {
          const session = arr.find(s => s.id === sessionId);
          if (session) session.starred = updated.starred;
        };

        updateInArray(this.sessions);
        updateInArray(this.archivedSessions);
        updateInArray(this.activeSessions);

        if (this.currentSession?.id === sessionId) {
          this.currentSession.starred = updated.starred;
        }

        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    addMessage(message) {
      // Prevent duplicate additions (can happen if WebSocket delivers message multiple times
      // or if fetchMessages returns the message while we're also receiving it via WebSocket)
      const exists = this.messages.some(m => m.id === message.id);
      if (!exists) {
        this.messages.push(message);
      }
    },

    async fetchWorkLogs(sessionId) {
      this.error = null;
      try {
        const grouped = await api.getSessionWorkLogs(sessionId);

        // Merge strategy: Use fetched data as base, but preserve any _unassociated
        // logs that arrived via WebSocket and aren't yet in the fetched data.
        // This prevents race conditions where logs arrive during the fetch.

        // Build a set of all log IDs from the fetched data
        const fetchedLogIds = new Set();
        for (const messageId of Object.keys(grouped)) {
          for (const log of grouped[messageId] || []) {
            fetchedLogIds.add(log.id);
          }
        }

        // Get existing unassociated logs that aren't in the fetched data
        // (these are logs that arrived via WebSocket during the fetch)
        const existingUnassociated = this.workLogs['_unassociated'] || [];
        const newUnassociatedLogs = existingUnassociated.filter(
          log => !fetchedLogIds.has(log.id)
        );

        // Merge: use fetched data, but append any truly new unassociated logs
        const fetchedUnassociated = grouped['_unassociated'] || [];
        this.workLogs = {
          ...grouped,
          '_unassociated': [...fetchedUnassociated, ...newUnassociatedLogs],
        };
      } catch (err) {
        this.error = err.message;
      }
    },

    addWorkLog(log) {
      const messageId = log.messageId || '_unassociated';
      const currentLogs = this.workLogs[messageId] || [];
      // Use spread to ensure new object reference for Vue reactivity
      this.workLogs = {
        ...this.workLogs,
        [messageId]: [...currentLogs, log],
      };
    },

    setWorkLogs(workLogs) {
      this.workLogs = workLogs;
    },

    clearWorkLogs() {
      this.workLogs = {};
      this.partialThinking = null;
    },

    // Associate unassociated work logs with a message ID
    associateWorkLogs(messageId) {
      const unassociated = this.workLogs['_unassociated'] || [];
      if (unassociated.length > 0) {
        const currentLogs = this.workLogs[messageId] || [];
        // Use spread to ensure new object reference for Vue reactivity
        this.workLogs = {
          ...this.workLogs,
          [messageId]: [...currentLogs, ...unassociated],
          '_unassociated': [],
        };
      }
    },

    // Set partial thinking content for streaming display
    setPartialThinking(thinking) {
      this.partialThinking = thinking;
    },

    // Clear partial thinking when complete
    clearPartialThinking() {
      this.partialThinking = null;
    },

    // ==================== USAGE ACTIONS ====================

    /**
     * Update running usage during a turn (partial update)
     * @param {Object} usage - Usage data
     * @param {string} [conversationId] - Conversation ID (Issue #175)
     */
    updateRunningUsage(usage, conversationId = null) {
      this.runningUsage = { ...usage, conversationId };
    },

    /**
     * Finalize usage at end of turn (update conversation and session with final values)
     * @param {Object} usage - Final cumulative usage
     * @param {string} [conversationId] - Conversation ID (Issue #175)
     */
    finalizeUsage(usage, conversationId = null) {
      // Update conversation usage if conversationId provided (Issue #175)
      if (conversationId) {
        const index = this.conversations.findIndex((c) => c.id === conversationId);
        if (index !== -1) {
          // Use splice to ensure Vue reactivity properly detects the change
          const updatedConversation = {
            ...this.conversations[index],
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            webSearchRequests: usage.webSearchRequests,
            contextWindow: usage.contextWindow,
            model: usage.model,
          };
          this.conversations.splice(index, 1, updatedConversation);
        }
      }

      // Also update session for backward compatibility
      if (this.currentSession) {
        this.currentSession = {
          ...this.currentSession,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests,
          contextWindow: usage.contextWindow,
        };
      }
      this.runningUsage = null;
    },

    /**
     * Update conversation usage from WebSocket event (Issue #175)
     * @param {string} conversationId - Conversation ID
     * @param {Object} usage - Usage data
     */
    updateConversationUsage(conversationId, usage) {
      const index = this.conversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        // Use splice to ensure Vue reactivity properly detects the change
        const updatedConversation = {
          ...this.conversations[index],
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests,
          contextWindow: usage.contextWindow,
          model: usage.model,
        };
        this.conversations.splice(index, 1, updatedConversation);
      }
    },

    /**
     * Clear running usage (on session unmount)
     */
    clearRunningUsage() {
      this.runningUsage = null;
    },

    updateSessionStatus(sessionId, status) {
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.status = status;
      }
      if (this.currentSession?.id === sessionId) {
        this.currentSession.status = status;
      }
    },

    async updateSessionThinking(sessionId, thinkingEnabled) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, { thinkingEnabled });
        // Update local state
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.thinkingEnabled = thinkingEnabled;
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession.thinkingEnabled = thinkingEnabled;
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async updateSessionMode(sessionId, mode) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, { mode });
        // Update local state
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.mode = mode;
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, mode };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async updateSessionModel(sessionId, model, providerId = undefined) {
      this.error = null;
      try {
        const updateData = { model };
        if (providerId !== undefined) {
          updateData.providerId = providerId;
        }
        const updated = await api.updateSession(sessionId, updateData);
        // Update local state
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.model = model;
          if (providerId !== undefined) {
            session.providerId = providerId;
          }
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession = {
            ...this.currentSession,
            model,
            ...(providerId !== undefined ? { providerId } : {}),
          };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Update session's next template (for template chaining)
     * @param {string} sessionId - Session ID
     * @param {string|null} nextTemplateId - Template ID or null to clear
     * @returns {Promise<Object>}
     */
    async updateNextTemplate(sessionId, nextTemplateId) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, { nextTemplateId });
        // Update local state
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.nextTemplateId = nextTemplateId;
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, nextTemplateId };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Generic async update for session fields via API
     * @param {string} sessionId - Session ID
     * @param {Object} updates - Fields to update (e.g., { status: 'starting', scheduledAt: null })
     * @returns {Promise<Object>} Updated session
     */
    async updateSessionFields(sessionId, updates) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, updates);
        // Update local state with all updated fields
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          Object.assign(session, updates);
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, ...updates };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Update session with new data from WebSocket
     * @param {Object} sessionData - Updated session data
     */
    updateSession(sessionData) {
      if (!sessionData?.id) return;

      // Handle archive status changes - route to correct list
      if (sessionData.archived === true) {
        // Capture existing session BEFORE removing it  - create a plain copy to avoid reactivity issues
        const existingSession = this.sessions.find(s => s.id === sessionData.id);
        const existingSessionCopy = existingSession ? { ...existingSession } : null;

        // Remove from non-archived lists
        this.sessions = this.sessions.filter((s) => s.id !== sessionData.id);
        this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionData.id);
        // Update or add to archived list
        const archivedIndex = this.archivedSessions.findIndex((s) => s.id === sessionData.id);
        if (archivedIndex !== -1) {
          this.archivedSessions[archivedIndex] = { ...this.archivedSessions[archivedIndex], ...sessionData };
        } else {
          // Preserve existing session properties when moving to archived
          this.archivedSessions.unshift(
            existingSessionCopy ? { ...existingSessionCopy, ...sessionData } : sessionData
          );
        }
      } else if (sessionData.archived === false) {
        // Capture existing session BEFORE removing it - create a plain copy to avoid reactivity issues
        const existingSession = this.archivedSessions.find(s => s.id === sessionData.id);
        const existingSessionCopy = existingSession ? { ...existingSession } : null;

        // Remove from archived list
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionData.id);
        // Update or add to sessions list
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        } else {
          // Preserve existing session properties when moving from archived
          this.sessions.unshift(
            existingSessionCopy ? { ...existingSessionCopy, ...sessionData } : sessionData
          );
        }
      } else {
        // No archive change - update in existing lists
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        }

        const archivedIndex = this.archivedSessions.findIndex((s) => s.id === sessionData.id);
        if (archivedIndex !== -1) {
          this.archivedSessions[archivedIndex] = { ...this.archivedSessions[archivedIndex], ...sessionData };
        }
      }

      // Update current session if it matches
      if (this.currentSession?.id === sessionData.id) {
        this.currentSession = { ...this.currentSession, ...sessionData };
      }

      // Update in active sessions list
      const activeIndex = this.activeSessions.findIndex((s) => s.id === sessionData.id);
      if (activeIndex !== -1) {
        this.activeSessions[activeIndex] = { ...this.activeSessions[activeIndex], ...sessionData };
      }

      // Handle scheduled status changes - add to or remove from scheduledSessions
      if (sessionData.status === 'scheduled') {
        // Add to scheduled list if not present
        const scheduledIndex = this.scheduledSessions.findIndex((s) => s.id === sessionData.id);
        if (scheduledIndex === -1) {
          this.scheduledSessions.push(sessionData);
        } else {
          // Update existing scheduled session
          this.scheduledSessions[scheduledIndex] = { ...this.scheduledSessions[scheduledIndex], ...sessionData };
        }
        // Re-sort after update (earliest first)
        this.scheduledSessions.sort((a, b) =>
          new Date(a.scheduledAt) - new Date(b.scheduledAt)
        );
      } else {
        // Remove from scheduled list when status changes from 'scheduled'
        this.scheduledSessions = this.scheduledSessions.filter((s) => s.id !== sessionData.id);
      }
    },

    /**
     * Add a newly created session to the list (from WebSocket)
     * @param {Object} session - New session data
     */
    addSessionToList(session) {
      if (!session?.id) return;

      // Check if session already exists (avoid duplicates)
      const exists = this.sessions.some((s) => s.id === session.id);
      if (!exists) {
        // Add to the beginning of the list (most recent first)
        this.sessions.unshift(session);
      }

      // Also add to active sessions if running/waiting
      if (session.status === 'running' || session.status === 'waiting' || session.status === 'starting') {
        const activeExists = this.activeSessions.some((s) => s.id === session.id);
        if (!activeExists) {
          this.activeSessions.unshift(session);
        }
      }
    },

    /**
     * Remove a session from lists (from WebSocket deletion)
     * @param {string} sessionId - Session ID to remove
     */
    removeSessionFromList(sessionId) {
      if (!sessionId) return;

      // Remove from sessions list
      this.sessions = this.sessions.filter((s) => s.id !== sessionId);

      // Remove from archived sessions list
      this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionId);

      // Remove from active sessions list
      this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionId);

      // Clear current session if it matches
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }
    },

    // ==================== CONVERSATION ACTIONS ====================

    /**
     * Fetch all conversations for a session
     * @param {string} sessionId - Session ID
     */
    async fetchConversations(sessionId) {
      this.error = null;
      try {
        this.conversations = await api.getConversations(sessionId);
        // Set active conversation to the one marked as active, or first one
        const active = this.conversations.find((c) => c.isActive);
        this.activeConversationId = active?.id || this.conversations[0]?.id || null;
      } catch (err) {
        this.error = err.message;
        this.conversations = [];
        this.activeConversationId = null;
      }
    },

    /**
     * Create a new conversation
     * @param {string} sessionId - Session ID
     * @param {string|null} name - Optional conversation name
     * @returns {Promise<Object>} The created conversation
     */
    async createConversation(sessionId, name = null) {
      this.error = null;
      try {
        const conversation = await api.createConversation(sessionId, name);
        // Add to list and set as active
        this.conversations.push(conversation);
        // Update isActive flags
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === conversation.id,
        }));
        this.activeConversationId = conversation.id;
        // Clear messages for new conversation
        this.messages = [];
        // Clear any streaming data since new conversation starts fresh
        this.runningUsage = null;
        return conversation;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Switch to a different conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID to switch to
     */
    async switchConversation(sessionId, conversationId) {
      if (this.activeConversationId === conversationId) return;

      this.error = null;
      try {
        // Clear stale streaming data from previous conversation
        this.runningUsage = null;

        // Update on server
        await api.updateConversation(sessionId, conversationId, { isActive: true });

        // Update local state
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === conversationId,
        }));
        this.activeConversationId = conversationId;

        // Fetch messages for new conversation
        const messages = await api.getConversationMessages(sessionId, conversationId);
        this.messages = messages;

        // Clear work logs and thinking, then re-fetch for new conversation context
        this.workLogs = {};
        this.partialThinking = null;
        await this.fetchWorkLogs(sessionId);
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Rename a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @param {string} name - New name
     */
    async renameConversation(sessionId, conversationId, name) {
      this.error = null;
      try {
        const updated = await api.updateConversation(sessionId, conversationId, { name });
        // Update in local state
        const index = this.conversations.findIndex((c) => c.id === conversationId);
        if (index !== -1) {
          this.conversations[index] = { ...this.conversations[index], ...updated };
        }
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Delete a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     */
    async deleteConversation(sessionId, conversationId) {
      this.error = null;
      try {
        await api.deleteConversation(sessionId, conversationId);
        // Remove from list
        this.conversations = this.conversations.filter((c) => c.id !== conversationId);

        // If we deleted the active conversation, switch to another
        if (this.activeConversationId === conversationId) {
          if (this.conversations.length > 0) {
            // Fetch conversations again to get the new active one
            await this.fetchConversations(sessionId);
            // Fetch messages for new active conversation
            if (this.activeConversationId) {
              const messages = await api.getConversationMessages(sessionId, this.activeConversationId);
              this.messages = messages;
            }
          } else {
            this.activeConversationId = null;
            this.messages = [];
          }
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Create a branch from a conversation at a specific message
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Source conversation ID
     * @param {string} messageId - Message ID to branch from
     * @param {string|null} name - Optional name for the branch
     * @param {string|null} prompt - Optional initial prompt for the branch
     * @returns {Promise<Object>} The created branch conversation
     */
    async branchConversation(sessionId, conversationId, messageId, name = null, prompt = null) {
      this.error = null;
      try {
        // 1. Create the branch (API call)
        const branchConversation = await api.branchConversation(sessionId, conversationId, {
          messageId,
          prompt,
        });

        // 2. Optimistically update store IMMEDIATELY
        // Add the new branch to the list (will also be added via WebSocket, but add here for immediate feedback)
        const exists = this.conversations.some((c) => c.id === branchConversation.id);
        if (!exists) {
          this.conversations.push(branchConversation);
        }

        // Update active state - the new branch is now active
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === branchConversation.id,
        }));
        this.activeConversationId = branchConversation.id;

        // 3. Clear work logs immediately (before async fetches)
        this.workLogs = {};
        this.partialThinking = null;

        // 4. Fetch messages and work logs in parallel WITHOUT blocking the return
        // This allows the UI to update immediately while data loads in the background
        Promise.all([
          api.getConversationMessages(sessionId, branchConversation.id)
            .then(messages => {
              // Only update if we're still on this conversation
              if (this.activeConversationId === branchConversation.id) {
                this.messages = messages;
              }
            })
            .catch(err => {
              console.error('Failed to fetch messages for branch:', err);
              // Don't set this.error here - branch was created successfully
            }),
          this.fetchWorkLogs(sessionId)
            .catch(err => {
              console.error('Failed to fetch work logs for branch:', err);
              // Don't set this.error here - branch was created successfully
            })
        ]);

        // 5. Return immediately after optimistic update
        return branchConversation;
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Update conversation from WebSocket event
     * @param {Object} conversation - Updated conversation data
     */
    updateConversation(conversation) {
      if (!conversation?.id) return;

      const index = this.conversations.findIndex((c) => c.id === conversation.id);
      if (index !== -1) {
        // Use splice to ensure Vue reactivity properly detects the change
        const updatedConversation = { ...this.conversations[index], ...conversation };
        this.conversations.splice(index, 1, updatedConversation);
      }

      // Update isActive flags if this conversation became active
      if (conversation.isActive) {
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === conversation.id,
        }));
        this.activeConversationId = conversation.id;
      }
    },

    /**
     * Add a new conversation from WebSocket event
     * @param {Object} conversation - New conversation data
     */
    addConversation(conversation) {
      if (!conversation?.id) return;

      // Check if already exists
      const exists = this.conversations.some((c) => c.id === conversation.id);
      if (!exists) {
        this.conversations.push(conversation);
      }

      // Update active state if this is the new active conversation
      if (conversation.isActive) {
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === conversation.id,
        }));
        this.activeConversationId = conversation.id;
        // Don't clear messages here - let the watcher's fetchMessages() replace them atomically
        // Clearing here causes isDraft to temporarily become true, hiding the messages
      }
    },

    /**
     * Remove a conversation from WebSocket event
     * @param {string} conversationId - Conversation ID
     * @param {Object|null} newActiveConversation - New active conversation if any
     */
    removeConversation(conversationId, newActiveConversation = null) {
      this.conversations = this.conversations.filter((c) => c.id !== conversationId);

      if (newActiveConversation) {
        // Add or update the new active conversation
        const exists = this.conversations.some((c) => c.id === newActiveConversation.id);
        if (!exists) {
          this.conversations.push(newActiveConversation);
        }
        this.conversations = this.conversations.map((c) => ({
          ...c,
          isActive: c.id === newActiveConversation.id,
        }));
        this.activeConversationId = newActiveConversation.id;
      } else if (this.activeConversationId === conversationId) {
        // Deleted the active conversation, pick first available
        this.activeConversationId = this.conversations[0]?.id || null;
      }
    },

    /**
     * Clear conversation state (when leaving session)
     */
    clearConversations() {
      this.conversations = [];
      this.activeConversationId = null;
    },

    /**
     * Toggle expanded state for a parent session
     */
    toggleSessionExpanded(sessionId) {
      if (this.expandedSessions.has(sessionId)) {
        this.expandedSessions.delete(sessionId);
      } else {
        this.expandedSessions.add(sessionId);
      }
    },

    /**
     * Save expanded sessions state to localStorage
     */
    saveExpandedState() {
      const expanded = Array.from(this.expandedSessions);
      try {
        localStorage.setItem('expandedSessions', JSON.stringify(expanded));
      } catch (error) {
        console.warn('Failed to save expanded sessions state:', error);
      }
    },

    /**
     * Restore expanded sessions state from localStorage
     */
    restoreExpandedState() {
      try {
        const expanded = localStorage.getItem('expandedSessions');
        if (expanded) {
          this.expandedSessions = new Set(JSON.parse(expanded));
        }
      } catch (error) {
        console.warn('Failed to restore expanded sessions state:', error);
        this.expandedSessions = new Set();
      }
    },

    /**
     * Set status filter and persist to localStorage
     * @param {string|null} filter - 'running' | 'idle' | null (null = show all)
     */
    setStatusFilter(filter) {
      this.statusFilter = filter;
      this.saveStatusFilter();
    },

    /**
     * Save status filter to localStorage
     */
    saveStatusFilter() {
      try {
        if (this.statusFilter) {
          localStorage.setItem('sessionStatusFilter', this.statusFilter);
        } else {
          localStorage.removeItem('sessionStatusFilter');
        }
      } catch (error) {
        console.warn('Failed to save status filter:', error);
      }
    },

    /**
     * Restore status filter from localStorage
     */
    restoreStatusFilter() {
      try {
        const filter = localStorage.getItem('sessionStatusFilter');
        if (filter === 'running' || filter === 'idle') {
          this.statusFilter = filter;
        }
      } catch (error) {
        console.warn('Failed to restore status filter:', error);
      }
    },

    /**
     * Set starred filter and persist to sessionStorage
     * @param {string|null} filter - 'starred' | 'unstarred' | null (null = show all)
     */
    setStarredFilter(filter) {
      this.starredFilter = filter;
      this.saveStarredFilter();
    },

    /**
     * Save starred filter to sessionStorage
     */
    saveStarredFilter() {
      try {
        if (this.starredFilter) {
          sessionStorage.setItem('sessionStarredFilter', this.starredFilter);
        } else {
          sessionStorage.removeItem('sessionStarredFilter');
        }
      } catch (error) {
        console.warn('Failed to save starred filter:', error);
      }
    },

    /**
     * Restore starred filter from sessionStorage
     * @param {string|null} filter - 'starred' | 'unstarred' | null (null = show all)
     */
    restoreStarredFilter() {
      try {
        const filter = sessionStorage.getItem('sessionStarredFilter');
        if (filter === 'starred' || filter === 'unstarred') {
          this.starredFilter = filter;
        } else {
          this.starredFilter = null;
        }
      } catch (error) {
        console.warn('Failed to restore starred filter:', error);
      }
    },

    /**
     * Set scheduled filter and persist to sessionStorage
     * @param {string|null} filter - 'scheduled' | 'not-scheduled' | null (null = show all)
     */
    setScheduledFilter(filter) {
      this.scheduledFilter = filter;
      this.saveScheduledFilter();
    },

    /**
     * Save scheduled filter to sessionStorage
     */
    saveScheduledFilter() {
      try {
        if (this.scheduledFilter) {
          sessionStorage.setItem('sessionScheduledFilter', this.scheduledFilter);
        } else {
          sessionStorage.removeItem('sessionScheduledFilter');
        }
      } catch (error) {
        console.warn('Failed to save scheduled filter:', error);
      }
    },

    /**
     * Restore scheduled filter from sessionStorage
     */
    restoreScheduledFilter() {
      try {
        const filter = sessionStorage.getItem('sessionScheduledFilter');
        if (filter === 'scheduled' || filter === 'not-scheduled') {
          this.scheduledFilter = filter;
        } else {
          this.scheduledFilter = null;
        }
      } catch (error) {
        console.warn('Failed to restore scheduled filter:', error);
      }
    },

    /**
     * Update a session's latestCommandRuns when command status changes via WebSocket
     * Used to keep session list command status indicators in sync with running/completed commands
     * @param {string} sessionId - Session ID
     * @param {string} buttonId - Command button ID
     * @param {Object} runData - Run data (buttonId, status, runId, startedAt/completedAt, exitCode)
     */
    updateSessionCommandRun(sessionId, buttonId, runData) {
      // Helper to create updated latestCommandRuns array
      const getUpdatedRuns = (session) => {
        if (!session) return null;

        const runs = [...(session.latestCommandRuns || [])];
        const existingIdx = runs.findIndex(r => r.buttonId === buttonId);

        if (existingIdx >= 0) {
          runs[existingIdx] = runData;
        } else {
          runs.push(runData);
        }
        return runs;
      };

      // Update in sessions list - replace the entire object to trigger Vue reactivity
      const sessionIndex = this.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex !== -1) {
        const updatedRuns = getUpdatedRuns(this.sessions[sessionIndex]);
        this.sessions[sessionIndex] = {
          ...this.sessions[sessionIndex],
          latestCommandRuns: updatedRuns,
        };
      }

      // Update in archived sessions list
      const archivedIndex = this.archivedSessions.findIndex(s => s.id === sessionId);
      if (archivedIndex !== -1) {
        const updatedRuns = getUpdatedRuns(this.archivedSessions[archivedIndex]);
        this.archivedSessions[archivedIndex] = {
          ...this.archivedSessions[archivedIndex],
          latestCommandRuns: updatedRuns,
        };
      }

      // Update in active sessions list
      const activeIndex = this.activeSessions.findIndex(s => s.id === sessionId);
      if (activeIndex !== -1) {
        const updatedRuns = getUpdatedRuns(this.activeSessions[activeIndex]);
        this.activeSessions[activeIndex] = {
          ...this.activeSessions[activeIndex],
          latestCommandRuns: updatedRuns,
        };
      }

      // Update current session if it matches
      if (this.currentSession?.id === sessionId) {
        const updatedRuns = getUpdatedRuns(this.currentSession);
        this.currentSession = {
          ...this.currentSession,
          latestCommandRuns: updatedRuns,
        };
      }

      // Increment version counter to force Vue reactivity in computed properties
      // that depend on latestCommandRuns (e.g., buttonStatusesToDisplay in SessionCard)
      this.commandRunVersion++;
    },
  },
});
