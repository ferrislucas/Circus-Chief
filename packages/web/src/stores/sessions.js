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
    // Token usage getters
    totalTokens: (state) => {
      const session = state.currentSession;
      if (!session) return 0;
      return (session.inputTokens || 0) + (session.outputTokens || 0);
    },
    formattedTokens: (state) => {
      const session = state.currentSession;
      if (!session) return { input: '0', output: '0', total: '0' };

      const format = (n) => {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
      };

      return {
        input: format(session.inputTokens || 0),
        output: format(session.outputTokens || 0),
        total: format((session.inputTokens || 0) + (session.outputTokens || 0)),
        cacheRead: format(session.cacheReadInputTokens || 0),
        cacheCreation: format(session.cacheCreationInputTokens || 0),
      };
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
     */
    updateRunningUsage(usage) {
      this.runningUsage = usage;
    },

    /**
     * Finalize usage at end of turn (update session with final values)
     * @param {Object} usage - Final cumulative usage
     */
    finalizeUsage(usage) {
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
          // Preserve existing session properties when moving to archived
          const existingSession = this.sessions.find(s => s.id === sessionData.id);
          this.archivedSessions.unshift(
            existingSession ? { ...existingSession, ...sessionData } : sessionData
          );
        }
      } else if (sessionData.archived === false) {
        // Remove from archived list
        this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionData.id);
        // Update or add to sessions list
        const sessionIndex = this.sessions.findIndex((s) => s.id === sessionData.id);
        if (sessionIndex !== -1) {
          this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...sessionData };
        } else {
          // Preserve existing session properties when moving from archived
          const existingSession = this.archivedSessions.find(s => s.id === sessionData.id);
          this.sessions.unshift(
            existingSession ? { ...existingSession, ...sessionData } : sessionData
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
  },
});
