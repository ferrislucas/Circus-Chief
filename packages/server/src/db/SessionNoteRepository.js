import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Session note repository class
 */
export class SessionNoteRepository extends BaseRepository {
  constructor() {
    super('session_notes', SessionNoteRepository.#mapNote);
  }

  static #mapNote(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(sessionId, content) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_notes (id, session_id, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, content, now, now);
    return this.getById(id);
  }

  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  update(id, content) {
    this.db
      .prepare('UPDATE session_notes SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), id);
    return this.getById(id);
  }

  /**
   * Duplicates all notes from one session to another.
   * @param {string} sourceSessionId - Source session ID
   * @param {string} targetSessionId - Target session ID
   */
  duplicateForSession(sourceSessionId, targetSessionId) {
    const notes = this.getBySessionId(sourceSessionId);

    for (const note of notes) {
      this.create(targetSessionId, note.content);
    }
  }
}
