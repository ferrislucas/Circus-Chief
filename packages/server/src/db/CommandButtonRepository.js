import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Command button repository class
 */
export class CommandButtonRepository extends BaseRepository {
  constructor() {
    super('command_buttons', CommandButtonRepository.#mapButton);
  }

  static #mapButton(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      label: row.label,
      command: row.command,
      sortOrder: row.sort_order,
      showOnList: row.show_on_list === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create({ projectId, label, command, sortOrder = 0, showOnList = false }) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO command_buttons (id, project_id, label, command, sort_order, show_on_list, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, label, command, sortOrder, showOnList ? 1 : 0, now, now);
    return this.getById(id);
  }

  getByProjectId(projectId) {
    const rows = this.db
      .prepare('SELECT * FROM command_buttons WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(projectId);
    return this.mapAll(rows);
  }

  update(id, data) {
    const updates = [];
    const values = [];

    if (data.label !== undefined) {
      updates.push('label = ?');
      values.push(data.label);
    }
    if (data.command !== undefined) {
      updates.push('command = ?');
      values.push(data.command);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      values.push(data.sortOrder);
    }
    if (data.showOnList !== undefined) {
      updates.push('show_on_list = ?');
      values.push(data.showOnList ? 1 : 0);
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE command_buttons SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
}
