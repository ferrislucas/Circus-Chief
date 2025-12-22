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
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      content: row.content,
      data: row.data,
      mimeType: row.mime_type,
      filename: row.filename,
      label: row.label,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
    };
  }

  create(sessionId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO canvas_items (id, session_id, type, content, data, mime_type, filename, label, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        data.type,
        data.content || null,
        data.data || null,
        data.mimeType || null,
        data.filename || null,
        data.label || null,
        data.width || null,
        data.height || null,
        now
      );
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM canvas_items WHERE session_id = ? ORDER BY created_at DESC')
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
         WHERE session_id = ? AND filename = ?
         ORDER BY created_at DESC`
      )
      .all(sessionId, filename);
    return this.mapAll(rows);
  }
}
