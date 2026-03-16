import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Kanban lane repository class
 */
export class KanbanLaneRepository extends BaseRepository {
  constructor() {
    super('kanban_lanes', KanbanLaneRepository.#mapLane);
  }

  static #mapLane(row) {
    return {
      id: row.id,
      boardId: row.board_id,
      name: row.name,
      sortOrder: row.sort_order,
      onEnterTemplateId: row.on_enter_template_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all lanes for a board, ordered by sort_order
   * @param {string} boardId
   * @returns {Array}
   */
  getByBoardId(boardId) {
    const rows = this.db
      .prepare('SELECT * FROM kanban_lanes WHERE board_id = ? ORDER BY sort_order')
      .all(boardId);
    return this.mapAll(rows);
  }

  /**
   * Create a new lane
   * @param {string} boardId
   * @param {Object} data
   * @param {string} data.name
   * @param {number} [data.sortOrder]
   * @param {string|null} [data.onEnterTemplateId]
   * @returns {Object}
   */
  create(boardId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // If no sortOrder provided, put it at the end
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined || sortOrder === null) {
      const maxRow = this.db
        .prepare('SELECT MAX(sort_order) as max_order FROM kanban_lanes WHERE board_id = ?')
        .get(boardId);
      sortOrder = (maxRow?.max_order ?? -1) + 1;
    }

    this.db
      .prepare(
        `INSERT INTO kanban_lanes (id, board_id, name, sort_order, on_enter_template_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, boardId, data.name, sortOrder, data.onEnterTemplateId || null, now, now);

    return this.getById(id);
  }

  /**
   * Update a lane
   * @param {string} id
   * @param {Object} data
   * @param {string} [data.name]
   * @param {number} [data.sortOrder]
   * @param {string|null} [data.onEnterTemplateId]
   * @returns {Object}
   */
  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(data.sortOrder);
    }
    if (data.onEnterTemplateId !== undefined) {
      updates.push('on_enter_template_id = ?');
      values.push(data.onEnterTemplateId);
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE kanban_lanes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Reorder lanes based on an array of lane IDs
   * @param {string} boardId
   * @param {string[]} laneIds - Ordered array of lane IDs
   */
  reorder(boardId, laneIds) {
    const now = Date.now();

    databaseManager.transaction(() => {
      const updateStmt = this.db.prepare(
        'UPDATE kanban_lanes SET sort_order = ?, updated_at = ? WHERE id = ? AND board_id = ?'
      );

      laneIds.forEach((laneId, index) => {
        updateStmt.run(index, now, laneId, boardId);
      });
    });
  }

  /**
   * Get a single lane with its board info
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    const row = this.db.prepare('SELECT * FROM kanban_lanes WHERE id = ?').get(id);
    return this.map(row);
  }

  /**
   * Get lane by ID with template info (for on-enter triggers)
   * @param {string} id
   * @returns {Object|null}
   */
  getByIdWithTemplate(id) {
    const row = this.db
      .prepare(
        `SELECT kl.*, st.name as template_name, st.prompt as template_prompt
         FROM kanban_lanes kl
         LEFT JOIN session_templates st ON kl.on_enter_template_id = st.id
         WHERE kl.id = ?`
      )
      .get(id);

    if (!row) return null;

    return {
      ...this.map(row),
      template: row.template_name
        ? {
            id: row.on_enter_template_id,
            name: row.template_name,
            prompt: row.template_prompt,
          }
        : null,
    };
  }

  /**
   * Delete a lane
   * @param {string} id
   */
  delete(id) {
    super.delete(id);
  }
}
