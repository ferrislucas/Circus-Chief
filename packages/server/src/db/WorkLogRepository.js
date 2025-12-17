import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Work log repository class
 */
export class WorkLogRepository extends BaseRepository {
  constructor() {
    super('work_logs', WorkLogRepository.#mapWorkLog);
  }

  static #mapWorkLog(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      type: row.type,
      toolName: row.tool_name,
      content: row.content,
      timestamp: row.timestamp,
    };
  }

  /**
   * Create a new work log entry
   * @param {string} sessionId - Session ID
   * @param {string} type - Log type ('thinking', 'tool_input', 'tool_output')
   * @param {string} content - Log content
   * @param {string|null} messageId - Associated message ID
   * @param {string|null} toolName - Tool name for tool-related logs
   * @returns {Object} Created work log
   */
  create(sessionId, type, content, messageId = null, toolName = null) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO work_logs (id, session_id, message_id, type, tool_name, content, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, messageId, type, toolName, content, now);
    return this.getById(id);
  }

  /**
   * Get all work logs for a session
   * @param {string} sessionId - Session ID
   * @returns {Array} Work logs ordered by timestamp
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM work_logs WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get work logs for a specific message
   * @param {string} messageId - Message ID
   * @returns {Array} Work logs for the message
   */
  getByMessageId(messageId) {
    const rows = this.db
      .prepare('SELECT * FROM work_logs WHERE message_id = ? ORDER BY timestamp ASC')
      .all(messageId);
    return this.mapAll(rows);
  }

  /**
   * Get work logs grouped by message for a session
   * @param {string} sessionId - Session ID
   * @returns {Object} Work logs keyed by message ID
   */
  getBySessionIdGrouped(sessionId) {
    const logs = this.getBySessionId(sessionId);
    const grouped = {};
    for (const log of logs) {
      const key = log.messageId || '_unassociated';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(log);
    }
    return grouped;
  }

  /**
   * Update the message ID for work logs (used when associating pending logs with a message)
   * @param {string} sessionId - Session ID
   * @param {string} messageId - Message ID to associate
   */
  associatePendingLogs(sessionId, messageId) {
    this.db
      .prepare('UPDATE work_logs SET message_id = ? WHERE session_id = ? AND message_id IS NULL')
      .run(messageId, sessionId);
  }

  /**
   * Delete all work logs for a session
   * @param {string} sessionId - Session ID
   */
  deleteBySessionId(sessionId) {
    this.db.prepare('DELETE FROM work_logs WHERE session_id = ?').run(sessionId);
  }
}
