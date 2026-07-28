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
    this.db.prepare(`DELETE FROM ${this.#tableName} WHERE id = ?`).run(id);
  }
}
