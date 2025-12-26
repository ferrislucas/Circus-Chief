import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
    archivedSessions: [],
    activeSessions: [],
    currentSession: null,
    messages: [],
    conversations: [], // All conversations for current session
    activeConversationId: null, // Currently selected conversation ID
    workLogs: {}, // Keyed by messageId: { [messageId]: WorkLog[] }
    partialThinking: null, // Current streaming thinking content
    expandedSessions: new Set(), // Track which parent sessions are expanded
    runningUsage: null, // Partial usage during a turn
    loading: false,
    error: null,
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
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
      };

      // Use active conversation tokens if available, fallback to session
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      const source = conv || state.currentSession;

      if (!source) return { input: '0', output: '0', total: '0', cacheRead: '0', cacheCreation: '0' };

      return {
        input: format(source.inputTokens || 0),
        output: format(source.outputTokens || 0),
        total: format((source.inputTokens || 0) + (source.outputTokens || 0)),
        cacheRead: format(source.cacheReadInputTokens || 0),
        cacheCreation: format(source.cacheCreationInputTokens || 0),
      };
    },
    contextPercentage: (state) => {
      // Calculate context usage percentage for the active conversation
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      const source = conv || state.currentSession;
      if (!source) return 0;

      const totalTokens = (source.inputTokens || 0) + (source.outputTokens || 0);
      const contextWindow = source.contextWindow || 200000;
      return Math.min(100, Math.round((totalTokens / contextWindow) * 100));
    },
    isUsageUpdating: (state) => {
      return state.runningUsage !== null;
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

    async fetchSessions(projectId) {
      this.loading = true;
      this.error = null;
      try {
        this.sessions = await api.getProjectSessions(projectId, false);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchArchivedSessions(projectId) {
      this.loading = true;
      this.error = null;
      try {
        this.archivedSessions = await api.getProjectSessions(projectId, true);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchSession(id, showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.currentSession = await api.getSession(id);
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
        this.messages = await api.getSessionMessages(sessionId);
      } catch (err) {
        this.error = err.message;
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

    async sendMessage(sessionId, content, files = []) {
      this.error = null;
      try {
        await api.sendMessage(sessionId, content, files);
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

    async startSession(id) {
      this.error = null;
      try {
        const result = await api.startSession(id);
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

    addMessage(message) {
      this.messages.push(message);
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
          this.conversations[index] = {
            ...this.conversations[index],
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            webSearchRequests: usage.webSearchRequests,
            contextWindow: usage.contextWindow,
            model: usage.model,
          };
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
        this.conversations[index] = {
          ...this.conversations[index],
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          webSearchRequests: usage.webSearchRequests,
          contextWindow: usage.contextWindow,
          model: usage.model,
        };
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

    async updateSessionModel(sessionId, model) {
      this.error = null;
      try {
        const updated = await api.updateSession(sessionId, { model });
        // Update local state
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.model = model;
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession = { ...this.currentSession, model };
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
     * Update session with new data from WebSocket
     * @param {Object} sessionData - Updated session data
     */
    updateSession(sessionData) {
      if (!sessionData?.id) return;

      // Handle archive status changes - route to correct list
      if (sessionData.archived === true) {
        // Remove from non-archived lists
        this.sessions = this.sessions.filter((s) => s.id !== sessionData.id);
        this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionData.id);
        // Update or add to archived list
        const archivedIndex = this.archivedSessions.findIndex((s) => s.id === sessionData.id);
        if (archivedIndex !== -1) {
          this.archivedSessions[archivedIndex] = { ...this.archivedSessions[archivedIndex], ...sessionData };
        } else {
          this.archivedSessions.unshift(sessionData);
        }
      } else if (sessionData.archived === false) {
        // Remove from archived list
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionData.id);
        // Update or add to sessions list
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        } else {
          this.sessions.unshift(sessionData);
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
     * Update conversation from WebSocket event
     * @param {Object} conversation - Updated conversation data
     */
    updateConversation(conversation) {
      if (!conversation?.id) return;

      const index = this.conversations.findIndex((c) => c.id === conversation.id);
      if (index !== -1) {
        this.conversations[index] = { ...this.conversations[index], ...conversation };
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
  },
});
