/**
 * Conversations API resource mixin
 * Adds conversation-related methods to ApiClient
 * @param {import('../ApiClient.js').ApiClient} ApiClient
 */
export function ConversationsApi(ApiClient) {
  Object.assign(ApiClient.prototype, {
    /**
     * Get all conversations for a session
     * @param {string} sessionId - Session ID
     * @returns {Promise<Array>}
     */
    async getConversations(sessionId) {
      return this._get(`/sessions/${sessionId}/conversations`);
    },

    /**
     * Create a new conversation
     * @param {string} sessionId - Session ID
     * @param {string|null} name - Optional conversation name
     * @returns {Promise<Object>}
     */
    async createConversation(sessionId, name = null) {
      return this._post(`/sessions/${sessionId}/conversations`, { name });
    },

    /**
     * Get a specific conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<Object>}
     */
    async getConversation(sessionId, conversationId) {
      return this._get(`/sessions/${sessionId}/conversations/${conversationId}`);
    },

    /**
     * Update a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @param {Object} data - Update data (name, isActive)
     * @returns {Promise<Object>}
     */
    async updateConversation(sessionId, conversationId, data) {
      return this._patch(`/sessions/${sessionId}/conversations/${conversationId}`, data);
    },

    /**
     * Delete a conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<void>}
     */
    async deleteConversation(sessionId, conversationId) {
      return this._delete(`/sessions/${sessionId}/conversations/${conversationId}`);
    },

    /**
     * Create a branch from a conversation at a specific message
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Source conversation ID
     * @param {Object} data - Branch data
     * @param {string} data.messageId - Message ID to branch from
     * @param {string} [data.name] - Optional name for the branch
     * @param {string} [data.prompt] - Optional initial prompt for the branch
     * @returns {Promise<Object>} The created branch conversation
     */
    async branchConversation(sessionId, conversationId, data) {
      return this._post(`/sessions/${sessionId}/conversations/${conversationId}/branch`, data);
    },

    /**
     * Get messages for a specific conversation
     * @param {string} sessionId - Session ID
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<Array>}
     */
    async getConversationMessages(sessionId, conversationId) {
      return this._get(`/sessions/${sessionId}/messages?conversation_id=${conversationId}`);
    },
  });
}
