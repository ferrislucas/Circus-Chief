import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import { allMigrations } from './migrations/index.js';
import { seedBaselineData } from './seedBaselineData.js';
import { bootstrapDefaultSessionTemplates } from './bootstrapDefaultSessionTemplates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database manager class - singleton pattern for managing SQLite connection
 */
export class DatabaseManager {
  #db = null;
  #dbPath = null;

  /**
   * Initialize database with WAL mode and foreign keys
   * @param {string} dbPath - Path to database file (use ':memory:' for in-memory)
   * @returns {Database.Database}
   */
  init(dbPath) {
    this.#dbPath = dbPath;
    this.#db = new Database(dbPath);

    // Enable WAL mode and foreign keys
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');

    // Detect first run BEFORE executing schema so we can distinguish a fresh
    // database from an existing one being upgraded. A first-run database has
    // no application tables yet; an existing one already has them.
    const isFirstRun = !this.#hasApplicationTables();

    // Run schema
    const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
    this.#db.exec(schema);

    // Seed required baseline data before future migrations run.
    seedBaselineData(this.#db);

    // Run post-baseline migrations for existing databases.
    this.#runMigrations();

    // Bootstrap default session templates once on a fresh database only.
    bootstrapDefaultSessionTemplates(this.#db, { isFirstRun });

    return this.#db;
  }

  /**
   * Return true when the database already contains application tables (i.e. it
   * is an existing database, not freshly created).
   * @private
   * @returns {boolean}
   */
  #hasApplicationTables() {
    const row = this.#db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects' LIMIT 1")
      .get();
    return row !== undefined;
  }

  /**
   * Get the path the database was initialized with.
   * @returns {string|null}
   */
  getPath() {
    return this.#dbPath;
  }

  /**
   * Run database migrations for existing databases.
   * Iterates over the flat, ordered list of migrations exported from
   * the migrations/ directory.
   * @private
   */
  #runMigrations() {
    for (const migration of allMigrations) {
      migration.up(this.#db);
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
      this.#dbPath = null;
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
