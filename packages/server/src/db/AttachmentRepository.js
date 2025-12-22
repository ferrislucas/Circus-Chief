import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

/** Directory name for storing attachments within working directory */
export const ATTACHMENTS_DIR = '.attachments';

/**
 * Get the attachments directory path for a session
 * @param {string} workingDirectory - Project working directory
 * @param {string} sessionId - Session ID
 * @returns {string} Path to attachments directory
 */
export function getAttachmentsDir(workingDirectory, sessionId) {
  return join(workingDirectory, ATTACHMENTS_DIR, sessionId);
}

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
      filePath: row.file_path,
      createdAt: row.created_at,
    };
  }

  /**
   * Create an attachment - stores in DB and saves to disk
   * @param {string} sessionId - Session ID
   * @param {string|null} messageId - Message ID (null for initial session creation)
   * @param {Object} file - File object with buffer, originalname, mimetype, size
   * @param {string} workingDirectory - Working directory to save file to
   * @returns {Object} Created attachment
   */
  create(sessionId, messageId, file, workingDirectory) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // Store as base64 for backwards compatibility
    const content = file.buffer.toString('base64');

    // Save file to disk if working directory provided
    let filePath = null;
    if (workingDirectory) {
      const attachmentsDir = getAttachmentsDir(workingDirectory, sessionId);
      mkdirSync(attachmentsDir, { recursive: true });

      // Use ID prefix to ensure uniqueness, preserve original filename for readability
      const diskFilename = `${id}_${file.originalname}`;
      filePath = join(attachmentsDir, diskFilename);
      writeFileSync(filePath, file.buffer);
    }

    this.db
      .prepare(
        `INSERT INTO message_attachments
         (id, message_id, session_id, filename, mime_type, size_bytes, storage_type, content, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        filePath,
        now
      );

    return this.getById(id);
  }

  /**
   * Create multiple attachments at once
   * @param {string} sessionId - Session ID
   * @param {string|null} messageId - Message ID
   * @param {Array} files - Array of file objects
   * @param {string} workingDirectory - Working directory to save files to
   * @returns {Array} Created attachments
   */
  createBatch(sessionId, messageId, files, workingDirectory) {
    if (!files || files.length === 0) return [];
    return files.map((file) => this.create(sessionId, messageId, file, workingDirectory));
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
        `SELECT id, message_id, session_id, filename, mime_type, size_bytes, storage_type, file_path, created_at
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
      filePath: row.file_path,
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

  /**
   * Delete all attachments for a session from disk
   * @param {string} workingDirectory - Working directory
   * @param {string} sessionId - Session ID
   */
  deleteSessionAttachmentsFromDisk(workingDirectory, sessionId) {
    if (!workingDirectory) return;

    const attachmentsDir = getAttachmentsDir(workingDirectory, sessionId);
    if (existsSync(attachmentsDir)) {
      rmSync(attachmentsDir, { recursive: true, force: true });
    }
  }
}
