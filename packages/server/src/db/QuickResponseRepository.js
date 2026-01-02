import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Quick response repository class
 */
export class QuickResponseRepository extends BaseRepository {
  constructor() {
    super('quick_responses', QuickResponseRepository.#mapResponse);
  }

  static #mapResponse(row) {
    return {
      id: row.id,
      projectId: row.project_id || null,
      label: row.label,
      content: row.content,
      autoSubmit: row.auto_submit === 1,
      category: row.category || null,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new quick response
   * @param {Object} data - Quick response data
   * @returns {Object} Created quick response
   */
  create(data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO quick_responses
         (id, project_id, label, content, auto_submit, category, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.projectId || null,
        data.label,
        data.content,
        data.autoSubmit ? 1 : 0,
        data.category || null,
        data.sortOrder ?? 0,
        now,
        now
      );

    return this.getById(id);
  }

  /**
   * Get all quick responses for a specific project (not including global)
   * @param {string} projectId - Project ID
   * @returns {Array} Array of quick responses
   */
  getByProjectId(projectId) {
    const rows = this.db
      .prepare(
        `SELECT * FROM quick_responses
         WHERE project_id = ?
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all(projectId);
    return this.mapAll(rows);
  }

  /**
   * Get all global quick responses (where project_id is NULL)
   * @returns {Array} Array of global quick responses
   */
  getGlobal() {
    const rows = this.db
      .prepare(
        `SELECT * FROM quick_responses
         WHERE project_id IS NULL
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all();
    return this.mapAll(rows);
  }

  /**
   * Get all available quick responses for a project (both project-specific and global)
   * @param {string} projectId - Project ID
   * @returns {Object} Object with project and global arrays
   */
  getAvailableForProject(projectId) {
    return {
      project: this.getByProjectId(projectId),
      global: this.getGlobal(),
    };
  }

  /**
   * Update a quick response
   * @param {string} id - Quick response ID
   * @param {Object} data - Fields to update
   * @returns {Object|null} Updated quick response or null if not found
   */
  update(id, data) {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }

    const updates = [];
    const values = [];

    if (data.label !== undefined) {
      updates.push('label = ?');
      values.push(data.label);
    }
    if (data.content !== undefined) {
      updates.push('content = ?');
      values.push(data.content);
    }
    if (data.autoSubmit !== undefined) {
      updates.push('auto_submit = ?');
      values.push(data.autoSubmit ? 1 : 0);
    }
    if (data.category !== undefined) {
      updates.push('category = ?');
      values.push(data.category);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(data.sortOrder);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);

      this.db
        .prepare(`UPDATE quick_responses SET ${updates.join(', ')} WHERE id = ?`)
        .run(...values);
    }

    return this.getById(id);
  }

  /**
   * Update sort order for multiple responses
   * @param {Array<{id: string, sortOrder: number}>} orders - Array of id/sortOrder pairs
   */
  updateSortOrder(orders) {
    const stmt = this.db.prepare(
      'UPDATE quick_responses SET sort_order = ?, updated_at = ? WHERE id = ?'
    );
    const now = Date.now();

    databaseManager.transaction(() => {
      for (const { id, sortOrder } of orders) {
        stmt.run(sortOrder, now, id);
      }
    });
  }

  /**
   * Delete a quick response
   * @param {string} id - Quick response ID
   * @returns {boolean} True if deleted, false if not found
   */
  deleteById(id) {
    const result = this.db
      .prepare('DELETE FROM quick_responses WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Delete all quick responses for a project
   * @param {string} projectId - Project ID
   */
  deleteByProjectId(projectId) {
    this.db
      .prepare('DELETE FROM quick_responses WHERE project_id = ?')
      .run(projectId);
  }
}
