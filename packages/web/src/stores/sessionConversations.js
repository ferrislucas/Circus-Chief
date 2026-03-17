import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useSessionConversationsStore = defineStore('sessionConversations', {
  state: () => ({
    conversations: [],
    activeConversationId: null,
    messages: [],
    workLogs: {},
  }),

  getters: {
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

    getWorkLogsForMessage: (state) => (messageId) => {
      return state.workLogs[messageId] || [];
    },

    getUnassociatedWorkLogs: (state) => {
      return state.workLogs['_unassociated'] || [];
    },
  },

  actions: {
    /**
     * Fetch all conversations for a session
     * @param {string} sessionId - Session ID
     */
    async fetchConversations(sessionId) {
      try {
        this.conversations = await api.getConversations(sessionId);
        const active = this.conversations.find((c) => c.isActive);
        this.activeConversationId = active?.id || this.conversations[0]?.id || null;
      } catch (err) {
        this.conversations = [];
        this.activeConversationId = null;
        throw err;
      }
    },

    /**
     * Create a new conversation
     * @param {string} sessionId - Session ID
     * @param {string|null} name - Optional conversation name
     * @returns {Promise<Object>} The created conversation
     */
    async createConversation(sessionId, name = null) {
      const conversation = await api.createConversation(sessionId, name);
      this.conversations.push(conversation);
      this.conversations = this.conversations.map((c) => ({
        ...c,
        isActive: c.id === conversation.id,
      }));
      this.activeConversationId = conversation.id;
      this.messages = [];
      return conversation;
    },

    /**
     * Switch to a different conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID to switch to
     * @param {Object} callbacks - Callbacks for streaming state cleanup
     * @param {Function} callbacks.clearStreamingState - Clear streaming state
     */
    async switchConversation(sessionId, conversationId, { clearStreamingState } = {}) {
      if (this.activeConversationId === conversationId) return;

      if (clearStreamingState) {
        clearStreamingState();
      }

      // Clear messages immediately before fetching new ones
      this.messages = [];
      this.workLogs = {};

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

      // Fetch work logs for new conversation context
      await this.fetchWorkLogs(sessionId);
    },

    /**
     * Rename a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @param {string} name - New name
     */
    async renameConversation(sessionId, conversationId, name) {
      const updated = await api.updateConversation(sessionId, conversationId, { name });
      const index = this.conversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        this.conversations[index] = { ...this.conversations[index], ...updated };
      }
      return updated;
    },

    /**
     * Delete a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     */
    async deleteConversation(sessionId, conversationId) {
      await api.deleteConversation(sessionId, conversationId);
      this.conversations = this.conversations.filter((c) => c.id !== conversationId);

      if (this.activeConversationId === conversationId) {
        if (this.conversations.length > 0) {
          await this.fetchConversations(sessionId);
          if (this.activeConversationId) {
            const messages = await api.getConversationMessages(sessionId, this.activeConversationId);
            this.messages = messages;
          }
        } else {
          this.activeConversationId = null;
          this.messages = [];
        }
      }
    },

    /**
     * Create a branch from a conversation at a specific message
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Source conversation ID
     * @param {string} messageId - Message ID to branch from
     * @param {Object} options - Branch options
     * @param {string|null} options.messageId - Message to branch from
     * @param {string|null} options.name - Optional name for the branch
     * @param {string|null} options.prompt - Optional initial prompt
     * @param {Function|null} options.clearStreamingState - Callback for streaming state cleanup
     * @returns {Promise<Object>} The created branch conversation
     */
    async branchConversation(sessionId, conversationId, options = {}) {
      const { messageId = null, name = null, prompt = null, clearStreamingState = null } = options || {};
      const branchConversation = await api.branchConversation(sessionId, conversationId, {
        messageId,
        prompt,
      });

      // Optimistically update store
      const exists = this.conversations.some((c) => c.id === branchConversation.id);
      if (!exists) {
        this.conversations.push(branchConversation);
      }

      this.conversations = this.conversations.map((c) => ({
        ...c,
        isActive: c.id === branchConversation.id,
      }));
      this.activeConversationId = branchConversation.id;

      // Clear stale data immediately
      this.messages = [];
      this.workLogs = {};
      if (clearStreamingState) {
        clearStreamingState();
      }

      // Fetch messages and work logs in parallel without blocking
      Promise.all([
        api.getConversationMessages(sessionId, branchConversation.id)
          .then(messages => {
            if (this.activeConversationId === branchConversation.id) {
              this.messages = messages;
            }
          })
          .catch(err => {
            console.error('Failed to fetch messages for branch:', err);
          }),
        this.fetchWorkLogs(sessionId)
          .catch(err => {
            console.error('Failed to fetch work logs for branch:', err);
          })
      ]);

      return branchConversation;
    },

    /**
     * Update conversation from WebSocket event
     * @param {Object} conversation - Updated conversation data
     * @param {string|null} currentSessionId - Current session ID for guard
     */
    updateConversation(conversation, currentSessionId = null) {
      if (!conversation?.id) return;
      if (currentSessionId && conversation.sessionId && conversation.sessionId !== currentSessionId) {
        return;
      }

      const index = this.conversations.findIndex((c) => c.id === conversation.id);
      if (index !== -1) {
        const updatedConversation = { ...this.conversations[index], ...conversation };
        this.conversations.splice(index, 1, updatedConversation);
      }

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
     * @param {string|null} currentSessionId - Current session ID for guard
     */
    addConversation(conversation, currentSessionId = null) {
      if (!conversation?.id) return;
      if (currentSessionId && conversation.sessionId && conversation.sessionId !== currentSessionId) {
        return;
      }

      const exists = this.conversations.some((c) => c.id === conversation.id);
      if (!exists) {
        this.conversations.push(conversation);
      }

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
     * @param {string|null} sessionId - Session ID for guard
     * @param {string|null} currentSessionId - Current session ID for guard
     */
    removeConversation(conversationId, newActiveConversation = null, sessionId = null, currentSessionId = null) {
      if (currentSessionId && sessionId && sessionId !== currentSessionId) {
        return;
      }
      this.conversations = this.conversations.filter((c) => c.id !== conversationId);

      if (newActiveConversation) {
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

    // ==================== MESSAGE ACTIONS ====================

    /**
     * Fetch messages for a session/conversation
     * @param {string} sessionId - Session ID
     * @param {boolean} showLoading - Whether to show loading state
     * @param {string|null} conversationId - Specific conversation ID
     */
    async fetchMessages(sessionId, showLoading = true, conversationId = null) {
      const cid = conversationId || this.activeConversationId;
      const fetchedMessages = cid
        ? await api.getConversationMessages(sessionId, cid)
        : await api.getSessionMessages(sessionId);

      // Smart merge: preserve messages added via WebSocket but not yet in API response
      const fetchedIds = new Set(fetchedMessages.map(m => m.id));
      const newMessages = this.messages.filter(m =>
        m.sessionId === sessionId && !fetchedIds.has(m.id)
      );

      if (newMessages.length > 0) {
        this.messages = [...fetchedMessages, ...newMessages];
      } else {
        this.messages = fetchedMessages;
      }
    },

    /**
     * Add a single message (from WebSocket)
     * @param {Object} message - Message data
     * @param {string|null} currentSessionId - Current session ID for guard
     */
    addMessage(message, currentSessionId = null) {
      if (currentSessionId && message.sessionId && message.sessionId !== currentSessionId) {
        return;
      }
      const exists = this.messages.some(m => m.id === message.id);
      if (!exists) {
        this.messages.push(message);
      }
    },

    // ==================== WORK LOG ACTIONS ====================

    async fetchWorkLogs(sessionId) {
      const grouped = await api.getSessionWorkLogs(sessionId);

      const fetchedLogIds = new Set();
      for (const messageId of Object.keys(grouped)) {
        for (const log of grouped[messageId] || []) {
          fetchedLogIds.add(log.id);
        }
      }

      const existingUnassociated = this.workLogs['_unassociated'] || [];
      const newUnassociatedLogs = existingUnassociated.filter(
        log => !fetchedLogIds.has(log.id)
      );

      const fetchedUnassociated = grouped['_unassociated'] || [];
      this.workLogs = {
        ...grouped,
        '_unassociated': [...fetchedUnassociated, ...newUnassociatedLogs],
      };
    },

    addWorkLog(log, currentSessionId = null) {
      if (currentSessionId && log.sessionId && log.sessionId !== currentSessionId) {
        return;
      }
      const messageId = log.messageId || '_unassociated';
      const currentLogs = this.workLogs[messageId] || [];
      const isDuplicate = currentLogs.some(l => l.id === log.id);
      if (isDuplicate) {
        return;
      }
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
    },

    associateWorkLogs(messageId) {
      const unassociated = this.workLogs['_unassociated'] || [];
      if (unassociated.length > 0) {
        const currentLogs = this.workLogs[messageId] || [];
        const currentIds = new Set(currentLogs.map(l => l.id));
        const newLogs = unassociated.filter(l => !currentIds.has(l.id));
        this.workLogs = {
          ...this.workLogs,
          [messageId]: [...currentLogs, ...newLogs],
          '_unassociated': [],
        };
      }
    },

    /**
     * Update conversation usage from WebSocket event
     * @param {string} conversationId - Conversation ID
     * @param {Object} usage - Usage data
     */
    updateConversationUsage(conversationId, usage) {
      const index = this.conversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
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
  },
});
