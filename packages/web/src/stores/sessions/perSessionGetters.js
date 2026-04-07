/**
 * Per-session getters shared between the main sessions store and overlay stores.
 * These operate on the store's own local state (messages, conversations, workLogs, etc.)
 * and are spread directly into the Pinia store getters.
 */
export const perSessionGetters = {
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
};
