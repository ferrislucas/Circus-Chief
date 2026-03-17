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
   * Supports both legacy and new signatures:
   * - Legacy: create(sessionId, type, content, messageId, toolName)
   * - New: create(sessionId, type, content, { messageId, toolName })
   * @param {string} sessionId - Session ID
   * @param {string} type - Log type ('thinking', 'tool_input', 'tool_output')
   * @param {string} content - Log content
   * @param {Object|string|null} optionsOrMessageId - Optional parameters object OR legacy messageId parameter
   * @param {string|null} legacyToolName - Legacy toolName parameter
   * @returns {Object} Created work log
   */
  create(sessionId, type, content, optionsOrMessageId = null, legacyToolName = null) {
    // Detect which signature is being used
    let messageId, toolName;

    if (optionsOrMessageId && typeof optionsOrMessageId === 'object' && !Array.isArray(optionsOrMessageId)) {
      // New signature: options object
      ({ messageId = null, toolName = null } = optionsOrMessageId);
    } else {
      // Legacy signature: individual parameters
      messageId = optionsOrMessageId;
      toolName = legacyToolName;
    }

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
   * @returns {number} Number of work logs that were associated
   */
  associatePendingLogs(sessionId, messageId) {
    const result = this.db
      .prepare('UPDATE work_logs SET message_id = ? WHERE session_id = ? AND message_id IS NULL')
      .run(messageId, sessionId);
    return result.changes;
  }

  /**
   * Delete all work logs for a session
   * @param {string} sessionId - Session ID
   */
  deleteBySessionId(sessionId) {
    this.db.prepare('DELETE FROM work_logs WHERE session_id = ?').run(sessionId);
  }
}
