import { RECENT_SEND_TTL_MS } from './perSessionActions.js';

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

  getWorkLogsForMessage: (state) => (messageId) => state.workLogs[messageId] || [],

  getUnassociatedWorkLogs: (state) => state.workLogs['_unassociated'] || [],

  partialThinking: (state) => {
    if (!state.currentSession?.id) return null;
    return state.partialThinkingBySession[state.currentSession.id] || null;
  },

  activeConversation: (state) => state.conversations.find((c) => c.id === state.activeConversationId) || null,

  getConversationById: (state) => (id) => state.conversations.find((c) => c.id === id),

  rootConversations: (state) => state.conversations.filter((c) => !c.parentConversationId),

  conversationTree: (state) => {
    const buildTree = (parentId = null) => state.conversations
        .filter((c) => c.parentConversationId === parentId)
        .map((conv) => ({ ...conv, children: buildTree(conv.id) }));
    return buildTree(null);
  },

  getConversationChildren: (state) => (conversationId) => state.conversations.filter((c) => c.parentConversationId === conversationId),

  getConversationParent: (state) => (conversationId) => {
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv?.parentConversationId) return null;
    return state.conversations.find((c) => c.id === conv.parentConversationId);
  },

  /**
   * Returns true when the given session had a Send/Start issued within the
   * last `RECENT_SEND_TTL_MS` (5 s). Used by `ConversationTab.onMounted`
   * and the status watcher to suppress restoring a just-sent prompt back
   * into the textarea.
   */
  hasRecentSend: (state) => (sessionId) => {
    if (!sessionId || !state.recentSends) return false;
    const ts = state.recentSends[sessionId];
    if (!ts) return false;
    return Date.now() - ts < RECENT_SEND_TTL_MS;
  },

  /**
   * Returns the kind of schedule-related mutation currently in flight for a
   * session on this store instance ('starting' | 'cancelling' | null).
   *
   * This is deliberately keyed by session id on the store itself (rather
   * than a local ref inside each composable instance) so every control
   * touching a given scheduled session — the "Start Now" button in
   * `SchedulingInfo`/`ScheduledChildCard`, the prompt submit button in
   * `ConversationTab`, and the Edit/Cancel actions — shares one in-flight
   * state and disables together, regardless of which component instance
   * triggered the mutation. See `beginScheduleMutation`/`endScheduleMutation`.
   */
  scheduleMutationInFlight: (state) => (sessionId) => {
    if (!sessionId || !state.scheduleMutationsInFlight) return null;
    return state.scheduleMutationsInFlight[sessionId] || null;
  },
};
