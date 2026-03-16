import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Kanban board repository class
 */
export class KanbanBoardRepository extends BaseRepository {
  constructor() {
    super('kanban_boards', KanbanBoardRepository.#mapBoard);
  }

  static #mapBoard(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get board by project ID
   * @param {string} projectId
   * @returns {Object|null}
   */
  getByProjectId(projectId) {
    const row = this.db
      .prepare('SELECT * FROM kanban_boards WHERE project_id = ?')
      .get(projectId);
    return this.map(row);
  }

  /**
   * Create a new kanban board with default lanes
   * @param {string} projectId
   * @returns {Object}
   */
  create(projectId) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // Use a transaction to create board and default lanes together
    return databaseManager.transaction(() => {
      // Create the board
      this.db
        .prepare(
          `INSERT INTO kanban_boards (id, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, projectId, now, now);

      // Create default lanes
      const defaultLanes = ['To Do', 'In Progress', 'Review', 'Done'];
      const insertLane = this.db.prepare(
        `INSERT INTO kanban_lanes (id, board_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      defaultLanes.forEach((name, index) => {
        insertLane.run(databaseManager.generateId(), id, name, index, now, now);
      });

      return this.getById(id);
    });
  }

  /**
   * Get or create a board for a project (lazy initialization)
   * @param {string} projectId
   * @returns {Object}
   */
  getOrCreateForProject(projectId) {
    const existing = this.getByProjectId(projectId);
    if (existing) {
      return existing;
    }
    return this.create(projectId);
  }

  /**
   * Delete a board and all its lanes and cards (cascade handled by FK)
   * @param {string} id
   */
  delete(id) {
    const now = Date.now();
    // Update timestamp before delete for any listeners
    this.db
      .prepare('UPDATE kanban_boards SET updated_at = ? WHERE id = ?')
      .run(now, id);
    super.delete(id);
  }
}
