import { databaseManager } from './DatabaseManager.js';

/**
 * Base repository class with common CRUD patterns
 */
export class BaseRepository {
  #tableName;
  #mapFn;

  constructor(tableName, mapFn) {
    this.#tableName = tableName;
    this.#mapFn = mapFn;
  }

  get tableName() {
    return this.#tableName;
  }

  get db() {
    return databaseManager.get();
  }

  map(row) {
    return row ? this.#mapFn(row) : null;
  }

  mapAll(rows) {
    return rows.map(this.#mapFn);
  }

  getById(id) {
    const row = this.db.prepare(`SELECT * FROM ${this.#tableName} WHERE id = ?`).get(id);
    return this.map(row);
  }

  delete(id) {
    // Defer FK constraint checking to the end of this (implicit, autocommit)
    // statement. Without this, a cascading delete (e.g. deleting a project
    // cascades to its sessions) can trip the `sessions.parent_session_id`
    // ON DELETE RESTRICT constraint mid-cascade if a parent row is removed
    // before its child row within the same cascade. Deferring means the
    // constraint is only checked once every affected row has been deleted,
    // which is what we want: cascades that fully remove a subtree succeed;
    // a delete that would truly orphan a surviving child still fails.
    this.db.pragma('defer_foreign_keys = ON');
    this.db.prepare(`DELETE FROM ${this.#tableName} WHERE id = ?`).run(id);
  }
}
