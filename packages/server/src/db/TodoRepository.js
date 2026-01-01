import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Session todo repository class
 */
export class TodoRepository extends BaseRepository {
  constructor() {
    super('session_todos', TodoRepository.#mapTodo);
  }

  static #mapTodo(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      status: row.status,
      position: row.position,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all todos for a session, ordered by position
   * @param {string} sessionId
   * @returns {Array}
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM session_todos WHERE session_id = ? ORDER BY position ASC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Replace all todos for a session with a new list
   * Called when Claude executes TodoWrite
   * @param {string} sessionId
   * @param {Array<{content: string, status: string}>} todos
   * @returns {Array}
   */
  replaceAll(sessionId, todos) {
    const now = Date.now();

    // Use a transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Delete existing todos
      this.db.prepare('DELETE FROM session_todos WHERE session_id = ?').run(sessionId);

      // Insert new todos
      const insert = this.db.prepare(
        `INSERT INTO session_todos (id, session_id, content, status, position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        const id = databaseManager.generateId();
        insert.run(id, sessionId, todo.content, todo.status, i, now);
      }
    });

    transaction();

    return this.getBySessionId(sessionId);
  }

  /**
   * Delete all todos for a session
   * @param {string} sessionId
   */
  deleteBySessionId(sessionId) {
    this.db.prepare('DELETE FROM session_todos WHERE session_id = ?').run(sessionId);
  }
}
