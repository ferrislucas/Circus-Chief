import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Project repository class
 */
export class ProjectRepository extends BaseRepository {
  constructor() {
    super('projects', ProjectRepository.#mapProject);
  }

  static #mapProject(row) {
    return {
      id: row.id,
      name: row.name,
      workingDirectory: row.working_directory,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(name, workingDirectory) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, working_directory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, workingDirectory, now, now);
    return this.getById(id);
  }

  getAll() {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return this.mapAll(rows);
  }

  update(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.workingDirectory !== undefined) {
      updates.push('working_directory = ?');
      values.push(data.workingDirectory);
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }
}
