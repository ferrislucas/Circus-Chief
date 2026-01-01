import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Message repository class
 */
export class MessageRepository extends BaseRepository {
  constructor() {
    super('conversation_messages', MessageRepository.#mapMessage);
  }

  static #mapMessage(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
      timestamp: row.timestamp,
    };
  }

  /**
   * Create a new message
   * @param {string} sessionId - The session ID
   * @param {string} role - The message role (user, assistant, system)
   * @param {string} content - The message content
   * @param {Object|null} toolUse - Optional tool use data
   * @param {string|null} conversationId - Optional conversation ID
   * @returns {Object} The created message
   */
  create(sessionId, role, content, toolUse = null, conversationId = null) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, tool_use, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, conversationId, role, content, toolUse ? JSON.stringify(toolUse) : null, now);
    return this.getById(id);
  }

  /**
   * Get all messages for a session (legacy, returns all messages)
   * @param {string} sessionId - The session ID
   * @returns {Array} List of messages
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get messages for a specific conversation
   * @param {string} conversationId - The conversation ID
   * @returns {Array} List of messages for the conversation
   */
  getByConversationId(conversationId) {
    const rows = this.db
      .prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY timestamp ASC')
      .all(conversationId);
    return this.mapAll(rows);
  }

  /**
   * Get message count for a conversation
   * @param {string} conversationId - The conversation ID
   * @returns {number} Number of messages
   */
  getCountByConversationId(conversationId) {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = ?')
      .get(conversationId);
    return result.count;
  }

  /**
   * Delete all messages for a conversation
   * @param {string} conversationId - The conversation ID
   */
  deleteByConversationId(conversationId) {
    this.db
      .prepare('DELETE FROM conversation_messages WHERE conversation_id = ?')
      .run(conversationId);
  }

  /**
   * Update message content
   * @param {string} messageId - The message ID
   * @param {string} content - The new content
   * @returns {Object} The updated message
   * @throws {Error} If message not found or content is empty
   */
  updateContent(messageId, content) {
    if (!content || content.trim() === '') {
      throw new Error('Message content cannot be empty');
    }

    // Update the message content
    this.db
      .prepare(
        `UPDATE conversation_messages SET content = ? WHERE id = ?`
      )
      .run(content, messageId);

    // Return the updated message
    return this.getById(messageId);
  }

  /**
   * Duplicates all messages from source conversations to target conversations.
   * @param {Map<string, string>} conversationIdMapping - Map of old conversation IDs to new IDs
   * @param {string} targetSessionId - The new session ID for the messages
   */
  duplicateForConversations(conversationIdMapping, targetSessionId) {
    for (const [sourceConvId, targetConvId] of conversationIdMapping) {
      const messages = this.getByConversationId(sourceConvId);

      for (const msg of messages) {
        this.create(
          targetSessionId,
          msg.role,
          msg.content,
          msg.toolUse,
          targetConvId
        );
      }
    }
  }
}
