import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Canvas item repository class
 */
export class CanvasItemRepository extends BaseRepository {
  constructor() {
    super('canvas_items', CanvasItemRepository.#mapCanvasItem);
  }

  static #mapCanvasItem(row) {
    // Parse JSON data for json type
    let data = row.data;
    if (row.type === 'json' && typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        // If parsing fails, keep as string
      }
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      content: row.content,
      data: data,
      mimeType: row.mime_type,
      filename: row.filename,
      width: row.width,
      height: row.height,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
    };
  }

  create(sessionId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // Serialize data field to JSON if it's an object
    let dataValue = data.data || null;
    if (dataValue !== null && typeof dataValue === 'object') {
      dataValue = JSON.stringify(dataValue);
    }

    this.db
      .prepare(
        `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        data.type,
        data.content || null,
        dataValue,
        data.mimeType || null,
        data.filename || null,
        data.width || null,
        data.height || null,
        now
      );
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM canvas_items WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get all versions of a file by filename, ordered newest first
   * @param {string} sessionId
   * @param {string} filename
   * @returns {Array} Array of canvas items with matching filename
   */
  getAllVersionsByFilename(sessionId, filename) {
    const rows = this.db
      .prepare(
        `SELECT * FROM canvas_items
         WHERE session_id = ? AND filename = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(sessionId, filename);
    return this.mapAll(rows);
  }

  /**
   * Get only deleted items for trash view
   * @param {string} sessionId
   * @returns {Array} Array of deleted canvas items
   */
  getDeletedBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM canvas_items WHERE session_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Soft delete: set deleted_at timestamp
   * @param {string} itemId
   * @returns {Object} The updated item
   */
  softDelete(itemId) {
    const now = Date.now();
    this.db
      .prepare('UPDATE canvas_items SET deleted_at = ? WHERE id = ?')
      .run(now, itemId);
    return this.getById(itemId);
  }

  /**
   * Recover: clear deleted_at timestamp
   * @param {string} itemId
   * @returns {Object} The recovered item
   */
  recover(itemId) {
    this.db
      .prepare('UPDATE canvas_items SET deleted_at = NULL WHERE id = ?')
      .run(itemId);
    return this.getById(itemId);
  }

  /**
   * Recover all versions of a file
   * @param {string} sessionId
   * @param {string} filename
   */
  recoverByFilename(sessionId, filename) {
    this.db
      .prepare('UPDATE canvas_items SET deleted_at = NULL WHERE session_id = ? AND filename = ? AND deleted_at IS NOT NULL')
      .run(sessionId, filename);
  }

  /**
   * Permanent delete (for emptying trash)
   * @param {string} itemId
   */
  permanentDelete(itemId) {
    this.db.prepare('DELETE FROM canvas_items WHERE id = ?').run(itemId);
  }

  /**
   * Duplicates all canvas items from one session to another.
   * Only copies non-deleted items.
   * @param {string} sourceSessionId - Source session ID
   * @param {string} targetSessionId - Target session ID
   */
  duplicateForSession(sourceSessionId, targetSessionId) {
    const items = this.getBySessionId(sourceSessionId);

    for (const item of items) {
      this.create(targetSessionId, {
        type: item.type,
        content: item.content,
        data: item.data,
        mimeType: item.mimeType,
        filename: item.filename,
        width: item.width,
        height: item.height,
      });
    }
  }

  /**
   * Soft delete multiple items atomically
   * @param {string[]} itemIds - Array of item IDs to soft delete
   * @returns {number} Count of items actually deleted
   */
  softDeleteBatch(itemIds) {
    if (!itemIds || itemIds.length === 0) {
      return 0;
    }

    const now = Date.now();
    const placeholders = itemIds.map(() => '?').join(',');

    const updateStmt = this.db.prepare(
      `UPDATE canvas_items SET deleted_at = ? WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    );

    const result = updateStmt.run(now, ...itemIds);
    return result.changes || 0;
  }

  /**
   * Recover multiple items atomically
   * @param {string[]} itemIds - Array of item IDs to recover
   * @returns {number} Count of items actually recovered
   */
  recoverBatch(itemIds) {
    if (!itemIds || itemIds.length === 0) {
      return 0;
    }

    const placeholders = itemIds.map(() => '?').join(',');

    const updateStmt = this.db.prepare(
      `UPDATE canvas_items SET deleted_at = NULL WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`
    );

    const result = updateStmt.run(...itemIds);
    return result.changes || 0;
  }

  /**
   * Permanently delete multiple items atomically
   * @param {string[]} itemIds - Array of item IDs to permanently delete (must be from trash)
   * @returns {number} Count of items actually deleted
   */
  permanentDeleteBatch(itemIds) {
    if (!itemIds || itemIds.length === 0) {
      return 0;
    }

    // Only allow permanent deletion of items that are in trash (deleted_at IS NOT NULL)
    const placeholders = itemIds.map(() => '?').join(',');

    const deleteStmt = this.db.prepare(
      `DELETE FROM canvas_items WHERE id IN (${placeholders}) AND deleted_at IS NOT NULL`
    );

    const result = deleteStmt.run(...itemIds);
    return result.changes || 0;
  }
}
