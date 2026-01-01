import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Conversation repository class for managing conversation threads within sessions
 */
export class ConversationRepository extends BaseRepository {
  constructor() {
    super('conversations', ConversationRepository.#mapConversation);
  }

  static #mapConversation(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      summary: row.summary,
      summaryGeneratedAt: row.summary_generated_at,
      isActive: row.is_active === 1,
      claudeSessionId: row.claude_session_id,
      // Token usage fields
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cacheReadInputTokens: row.cache_read_input_tokens || 0,
      cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
      webSearchRequests: row.web_search_requests || 0,
      contextWindow: row.context_window || 200000,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
      ...ConversationRepository.#mapConversation(row),
      messageCount: row.message_count,
    }));
  }

  /**
   * Update a conversation
   * @param {string} id - The conversation ID
   * @param {Object} data - Fields to update
   * @returns {Object} The updated conversation
   */
  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.summary !== undefined) {
      updates.push('summary = ?');
      values.push(data.summary);
    }
    if (data.summaryGeneratedAt !== undefined) {
      updates.push('summary_generated_at = ?');
      values.push(data.summaryGeneratedAt);
    }
    if (data.claudeSessionId !== undefined) {
      updates.push('claude_session_id = ?');
      values.push(data.claudeSessionId);
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
   * @param {number} usage.cacheReadInputTokens
   * @param {number} usage.cacheCreationInputTokens
   * @param {number} usage.webSearchRequests
   * @param {number} usage.contextWindow
   * @param {string} [usage.model]
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
          cache_read_input_tokens = ?,
          cache_creation_input_tokens = ?,
          web_search_requests = ?,
          context_window = ?,
          model = COALESCE(?, model),
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadInputTokens,
        usage.cacheCreationInputTokens,
        usage.webSearchRequests,
        usage.contextWindow,
        usage.model || null,
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
          `INSERT INTO conversations (id, session_id, name, summary, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          targetSessionId,
          conv.name,
          conv.summary,
          conv.isActive ? 1 : 0,
          now,
          now
        );

      idMapping.set(conv.id, id);
    }

    return idMapping;
  }
}
