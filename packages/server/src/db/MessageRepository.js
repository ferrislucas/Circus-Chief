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
      role: row.role,
      content: row.content,
      toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
      timestamp: row.timestamp,
    };
  }

  create(sessionId, role, content, toolUse = null) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO conversation_messages (id, session_id, role, content, tool_use, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, role, content, toolUse ? JSON.stringify(toolUse) : null, now);
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }
}
