import { api } from '../../composables/useApi.js';

/**
 * Conversation-related actions for the sessions store.
 * These are spread directly into the Pinia store actions, so `this` refers to the store instance.
 */
export const conversationActions = {
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

  async branchConversation(sessionId, conversationId, options = {}) {
    const { messageId = null, name = null, prompt = null } = options || {};
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
};
