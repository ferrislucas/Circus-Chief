import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database manager class - singleton pattern for managing SQLite connection
 */
export class DatabaseManager {
  #db = null;

  /**
   * Initialize database with WAL mode and foreign keys
   * @param {string} dbPath - Path to database file (use ':memory:' for in-memory)
   * @returns {Database.Database}
   */
  init(dbPath = 'claudetools.db') {
    this.#db = new Database(dbPath);

    // Enable WAL mode and foreign keys
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');

    // Run schema
    const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
    this.#db.exec(schema);

    // Run migrations for existing databases
    this.#runMigrations();

    return this.#db;
  }

  /**
   * Run database migrations for existing databases
   * @private
   */
  #runMigrations() {
    // Check if sessions table has the new columns, add them if not
    const sessionsTableInfo = this.#db.prepare('PRAGMA table_info(sessions)').all();
    const sessionsColumns = sessionsTableInfo.map((col) => col.name);

    if (!sessionsColumns.includes('cost_usd')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN cost_usd REAL DEFAULT 0');
    }
    if (!sessionsColumns.includes('claude_session_id')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN claude_session_id TEXT');
    }
    if (!sessionsColumns.includes('model')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN model TEXT');
    }

    // Check if projects table has the system_prompt column, add it if not
    const projectsTableInfo = this.#db.prepare('PRAGMA table_info(projects)').all();
    const projectsColumns = projectsTableInfo.map((col) => col.name);

    if (!projectsColumns.includes('system_prompt')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN system_prompt TEXT');
    }
  }

  /**
   * Get the database instance
   * @returns {Database.Database}
   */
  get() {
    if (!this.#db) {
      throw new Error('Database not initialized. Call init first.');
    }
    return this.#db;
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }

  /**
   * Generate a UUID
   * @returns {string}
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Run a function inside a transaction
   * @param {Function} fn - Function to run in transaction
   * @returns {any}
   */
  transaction(fn) {
    return this.get().transaction(fn)();
  }
}

// Singleton instance
export const databaseManager = new DatabaseManager();
