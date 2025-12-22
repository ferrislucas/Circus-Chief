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
    if (!projectsColumns.includes('on_session_created')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN on_session_created TEXT');
    }
    if (!projectsColumns.includes('on_session_deleted')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN on_session_deleted TEXT');
    }

    // Migrate sessions table to add 'stopped' status to CHECK constraint
    // SQLite doesn't allow modifying CHECK constraints, so we need to recreate the table
    this.#migrateSessionsStatusConstraint();

    // Check if session_summaries table has the PR status columns, add them if not
    const summariesTableInfo = this.#db.prepare('PRAGMA table_info(session_summaries)').all();
    const summariesColumns = summariesTableInfo.map((col) => col.name);

    if (!summariesColumns.includes('pr_merged')) {
      this.#db.exec('ALTER TABLE session_summaries ADD COLUMN pr_merged INTEGER');
    }
    if (!summariesColumns.includes('pr_state')) {
      this.#db.exec('ALTER TABLE session_summaries ADD COLUMN pr_state TEXT');
    }
    if (!summariesColumns.includes('has_merge_conflicts')) {
      this.#db.exec('ALTER TABLE session_summaries ADD COLUMN has_merge_conflicts INTEGER');
    }
    if (!summariesColumns.includes('ci_status')) {
      this.#db.exec('ALTER TABLE session_summaries ADD COLUMN ci_status TEXT');
    }
    if (!summariesColumns.includes('ci_failures')) {
      this.#db.exec('ALTER TABLE session_summaries ADD COLUMN ci_failures TEXT');
    }

    // Check if message_attachments table has the file_path column, add it if not
    const attachmentsTableInfo = this.#db.prepare('PRAGMA table_info(message_attachments)').all();
    const attachmentsColumns = attachmentsTableInfo.map((col) => col.name);

    if (!attachmentsColumns.includes('file_path')) {
      this.#db.exec('ALTER TABLE message_attachments ADD COLUMN file_path TEXT');
    }
  }

  /**
   * Migrate sessions table to include 'stopped' in status CHECK constraint
   * SQLite doesn't support ALTER TABLE to modify constraints, so we recreate the table
   * @private
   */
  #migrateSessionsStatusConstraint() {
    // Check if the current constraint includes 'stopped' by trying to read it from sqlite_master
    const tableSchema = this.#db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'")
      .get();

    // If schema includes 'stopped', no migration needed
    if (tableSchema?.sql?.includes("'stopped'")) {
      return;
    }

    // Need to recreate table with updated constraint
    // Use a transaction to ensure atomicity
    this.#db.exec(`
      -- Create new table with updated constraint
      CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'completed', 'error')),
        mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('plan', 'standard', 'yolo')),
        thinking_enabled INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        git_worktree TEXT,
        pr_url TEXT,
        error TEXT,
        cost_usd REAL DEFAULT 0,
        claude_session_id TEXT,
        model TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- Copy data from old table
      INSERT INTO sessions_new SELECT * FROM sessions;

      -- Drop old table
      DROP TABLE sessions;

      -- Rename new table
      ALTER TABLE sessions_new RENAME TO sessions;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `);
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
