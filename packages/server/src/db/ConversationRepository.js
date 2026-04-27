import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { mapConversationRow, executeBranch } from './conversation-helpers.js';

/**
 * Conversation repository class for managing conversation threads within sessions
 */
export class ConversationRepository extends BaseRepository {
  constructor() {
    super('conversations', mapConversationRow);
  }

  /**
   * Create a new conversation for a session
   * @param {string} sessionId - The session ID
   * @param {string} [name] - Optional name for the conversation
   * @param {boolean} [isActive=true] - Whether this is the active conversation
   * @returns {Object} The created conversation
   */
  create(sessionId, name = null, isActive = true) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // If this conversation should be active, deactivate others first
    if (isActive) {
      this.db
        .prepare('UPDATE conversations SET is_active = 0, updated_at = ? WHERE session_id = ?')
        .run(now, sessionId);
    }

    this.db
      .prepare(
        `INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, name, isActive ? 1 : 0, now, now);

    return this.getById(id);
  }

  /**
   * Get all conversations for a session
   * @param {string} sessionId - The session ID
   * @returns {Array} List of conversations ordered by creation time
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM conversations WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get the active conversation for a session
   * @param {string} sessionId - The session ID
   * @returns {Object|null} The active conversation or null
   */
  getActiveBySessionId(sessionId) {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE session_id = ? AND is_active = 1')
      .get(sessionId);
    return this.map(row);
  }

  /**
   * Get conversation with message count
   * @param {string} sessionId - The session ID
   * @returns {Array} Conversations with messageCount property
   */
  getBySessionIdWithMessageCount(sessionId) {
    const rows = this.db
      .prepare(`
        SELECT c.*, COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN conversation_messages m ON m.conversation_id = c.id
        WHERE c.session_id = ?
        GROUP BY c.id
        ORDER BY c.created_at ASC
      `)
      .all(sessionId);

    return rows.map((row) => ({
      ...mapConversationRow(row),
      messageCount: row.message_count,
    }));
  }

  /**
   * Update a conversation
   * @param {string} id - The conversation ID
   * @param {Object} data - Fields to update
   * @returns {Object} The updated conversation
   */
  /**
   * Build the SET clause fields from data, collecting updates and values.
   * Handles the isActive special case (deactivating other conversations).
   * @param {string} id - Conversation ID
   * @param {Object} data - Fields to update
   * @returns {{ updates: string[], values: any[] }}
   */
  #buildUpdateFields(id, data) {
    const FIELD_MAP = {
      name: 'name',
      summary: 'summary',
      summaryGeneratedAt: 'summary_generated_at',
      claudeSessionId: 'claude_session_id',
    };

    const updates = [];
    const values = [];

    for (const [key, column] of Object.entries(FIELD_MAP)) {
      if (data[key] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(data[key]);
      }
    }

    if (data.isActive !== undefined) {
      // If setting this conversation as active, deactivate others first
      if (data.isActive) {
        const conv = this.getById(id);
        if (conv) {
          this.db
            .prepare('UPDATE conversations SET is_active = 0, updated_at = ? WHERE session_id = ? AND id != ?')
            .run(Date.now(), conv.sessionId, id);
        }
      }
      updates.push('is_active = ?');
      values.push(data.isActive ? 1 : 0);
    }

    return { updates, values };
  }

  update(id, data) {
    const { updates, values } = this.#buildUpdateFields(id, data);

    if (updates.length === 0) {
      return this.getById(id);
    }

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db
      .prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getById(id);
  }

  /**
   * Set a conversation as active (and deactivate others)
   * @param {string} id - The conversation ID to activate
   * @returns {Object} The updated conversation
   */
  setActive(id) {
    return this.update(id, { isActive: true });
  }

  /**
   * Delete a conversation and handle edge cases
   * @param {string} id - The conversation ID
   * @returns {Object|null} The new active conversation if one was auto-created
   */
  deleteAndHandleActive(id) {
    const conv = this.getById(id);
    if (!conv) return null;

    const wasActive = conv.isActive;
    const sessionId = conv.sessionId;

    // Delete the conversation (messages will be cascade deleted)
    this.delete(id);

    // If we deleted the active conversation, activate another one
    if (wasActive) {
      const remaining = this.getBySessionId(sessionId);
      if (remaining.length > 0) {
        // Activate the most recent conversation
        return this.setActive(remaining[remaining.length - 1].id);
      } else {
        // No conversations left - create a new empty one
        return this.create(sessionId, 'New Conversation', true);
      }
    }

    return null;
  }

  /**
   * Ensure a session has at least one conversation, creating one if needed
   * @param {string} sessionId - The session ID
   * @returns {Object} The active conversation
   */
  ensureActiveConversation(sessionId) {
    let active = this.getActiveBySessionId(sessionId);
    if (!active) {
      // Check if there are any conversations at all
      const conversations = this.getBySessionId(sessionId);
      if (conversations.length > 0) {
        // Activate the first one
        active = this.setActive(conversations[0].id);
      } else {
        // Create a new conversation
        active = this.create(sessionId, 'Initial', true);
      }
    }
    return active;
  }

  /**
   * Auto-generate a conversation name from the first user message
   * @param {string} id - The conversation ID
   * @param {string} firstMessage - The first user message content
   * @returns {Object} The updated conversation
   */
  autoName(id, firstMessage) {
    // Take first 50 chars of the message, truncate at word boundary
    let name = firstMessage.substring(0, 50);
    const lastSpace = name.lastIndexOf(' ');
    if (lastSpace > 30) {
      name = name.substring(0, lastSpace);
    }
    if (firstMessage.length > 50) {
      name += '...';
    }

    return this.update(id, { name });
  }

  /**
   * Update token usage statistics for a conversation
   * @param {string} id - Conversation ID
   * @param {Object} usage - Usage data
   * @param {number} usage.inputTokens
   * @param {number} usage.outputTokens
   * @param {number} usage.thinkingTokens
   * @param {number} usage.cacheReadInputTokens
   * @param {number} usage.cacheCreationInputTokens
   * @param {number} usage.webSearchRequests
   * @param {number} usage.contextWindow
   * @returns {Object|null} Updated conversation or null if not found
   */
  updateUsage(id, usage) {
    const conversation = this.getById(id);
    if (!conversation) {
      return null;
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE conversations SET
          input_tokens = ?,
          output_tokens = ?,
          thinking_tokens = ?,
          cache_read_input_tokens = ?,
          cache_creation_input_tokens = ?,
          web_search_requests = ?,
          context_window = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        usage.inputTokens,
        usage.outputTokens,
        usage.thinkingTokens || 0,
        usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens,
        usage.webSearchRequests,
        usage.contextWindow,
        now,
        id
      );
    return this.getById(id);
  }

  /**
   * Duplicates all conversations from one session to another.
   * @param {string} sourceSessionId - Source session ID
   * @param {string} targetSessionId - Target session ID
   * @returns {Map<string, string>} Mapping of old conversation IDs to new IDs
   */
  duplicateForSession(sourceSessionId, targetSessionId) {
    const sourceConversations = this.getBySessionId(sourceSessionId);
    const idMapping = new Map();

    for (const conv of sourceConversations) {
      const id = databaseManager.generateId();
      const now = Date.now();

      this.db
      .prepare(
          `INSERT INTO conversations (id, session_id, name, summary, is_active,
                                      input_tokens, output_tokens, thinking_tokens,
                                      cache_read_input_tokens, cache_creation_input_tokens,
                                      web_search_requests, context_window, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          targetSessionId,
          conv.name,
          conv.summary,
          conv.isActive ? 1 : 0,
          conv.inputTokens,
          conv.outputTokens,
          conv.thinkingTokens,
          conv.cacheReadInputTokens,
          conv.cacheCreationInputTokens,
          conv.webSearchRequests,
          conv.contextWindow,
          now,
          now
        );

      idMapping.set(conv.id, id);
    }

    return idMapping;
  }

  /**
   * Create a branch from an existing conversation at a specific message
   * Copies all messages BEFORE the specified message to a new conversation,
   * then adds the initialPrompt as a replacement for that message
   * @param {string} conversationId - The source conversation ID
   * @param {string} messageId - The message ID to branch from (messages before this are copied, this message is replaced)
   * @param {string} [name] - Optional name for the new conversation (if not provided, auto-generated from prompt)
   * @param {string} initialPrompt - Required: the new prompt that replaces the branch point message
   * @returns {Object} The created branch conversation
   */
  branch(conversationId, messageId, name = null, initialPrompt = null) {
    return executeBranch(this, conversationId, messageId, { name, initialPrompt });
  }

  /**
   * Get conversations for a session with branch hierarchy info
   * @param {string} sessionId - The session ID
   * @returns {Array} Conversations with childCount property
   */
  getBySessionIdWithBranchInfo(sessionId) {
    const rows = this.db
      .prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM conversations child WHERE child.parent_conversation_id = c.id) as child_count,
          (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) as message_count
        FROM conversations c
        WHERE c.session_id = ?
        ORDER BY c.created_at ASC
      `)
      .all(sessionId);

    return rows.map((row) => ({
      ...mapConversationRow(row),
      childCount: row.child_count || 0,
      messageCount: row.message_count || 0,
    }));
  }

  /**
   * Get child conversations (branches) of a conversation
   * @param {string} parentConversationId - The parent conversation ID
   * @returns {Array} Child conversations
   */
  getChildren(parentConversationId) {
    const rows = this.db
      .prepare('SELECT * FROM conversations WHERE parent_conversation_id = ? ORDER BY created_at ASC')
      .all(parentConversationId);
    return this.mapAll(rows);
  }

  /**
   * Get the branch point message for a conversation
   * @param {string} conversationId - The conversation ID
   * @returns {Object|null} The branch point message or null if not a branch
   */
  getBranchPointMessage(conversationId) {
    const conv = this.getById(conversationId);
    if (!conv || !conv.branchFromMessageId) {
      return null;
    }

    const row = this.db
      .prepare('SELECT * FROM conversation_messages WHERE id = ?')
      .get(conv.branchFromMessageId);

    if (!row) return null;

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
}
