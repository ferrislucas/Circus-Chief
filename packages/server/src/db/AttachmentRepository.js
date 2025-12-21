import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Attachment repository class for message file attachments
 */
export class AttachmentRepository extends BaseRepository {
  constructor() {
    super('message_attachments', AttachmentRepository.#mapAttachment);
  }

  static #mapAttachment(row) {
    return {
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size_bytes,
      storageType: row.storage_type,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  /**
   * Create an attachment
   * @param {string} sessionId - Session ID
   * @param {string|null} messageId - Message ID (null for initial session creation)
   * @param {Object} file - File object with buffer, originalname, mimetype, size
   * @returns {Object} Created attachment
   */
  create(sessionId, messageId, file) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // Store as base64
    const content = file.buffer.toString('base64');

    this.db
      .prepare(
        `INSERT INTO message_attachments
         (id, message_id, session_id, filename, mime_type, size_bytes, storage_type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        messageId,
        sessionId,
        file.originalname,
        file.mimetype,
        file.size,
        'base64',
        content,
        now
      );

    return this.getById(id);
  }

  /**
   * Create multiple attachments at once
   * @param {string} sessionId - Session ID
   * @param {string|null} messageId - Message ID
   * @param {Array} files - Array of file objects
   * @returns {Array} Created attachments
   */
  createBatch(sessionId, messageId, files) {
    if (!files || files.length === 0) return [];
    return files.map((file) => this.create(sessionId, messageId, file));
  }

  /**
   * Get attachments by message ID
   * @param {string} messageId - Message ID
   * @returns {Array} Attachments for the message
   */
  getByMessageId(messageId) {
    const rows = this.db
      .prepare('SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC')
      .all(messageId);
    return this.mapAll(rows);
  }

  /**
   * Get attachments by session ID
   * @param {string} sessionId - Session ID
   * @returns {Array} Attachments for the session
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM message_attachments WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get attachments without content (for listing)
   * @param {string} messageId - Message ID
   * @returns {Array} Attachments without content field
   */
  getByMessageIdWithoutContent(messageId) {
    const rows = this.db
      .prepare(
        `SELECT id, message_id, session_id, filename, mime_type, size_bytes, storage_type, created_at
         FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC`
      )
      .all(messageId);
    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size_bytes,
      storageType: row.storage_type,
      createdAt: row.created_at,
    }));
  }

  /**
   * Update message ID for attachments (used when associating with a message)
   * @param {string} sessionId - Session ID
   * @param {string} messageId - Message ID to set
   */
  updateMessageIdForSession(sessionId, messageId) {
    this.db
      .prepare('UPDATE message_attachments SET message_id = ? WHERE session_id = ? AND message_id IS NULL')
      .run(messageId, sessionId);
  }

  /**
   * Get pending attachments (those without a message ID)
   * @param {string} sessionId - Session ID
   * @returns {Array} Attachments without message ID
   */
  getPendingBySessionId(sessionId) {
    const rows = this.db
      .prepare(
        'SELECT * FROM message_attachments WHERE session_id = ? AND message_id IS NULL ORDER BY created_at ASC'
      )
      .all(sessionId);
    return this.mapAll(rows);
  }
}
