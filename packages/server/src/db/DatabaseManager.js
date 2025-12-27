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
    if (!projectsColumns.includes('disable_session_summaries')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN disable_session_summaries INTEGER NOT NULL DEFAULT 0');
    }
    if (!projectsColumns.includes('disable_conversation_summaries')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN disable_conversation_summaries INTEGER NOT NULL DEFAULT 0');
    }
    if (!projectsColumns.includes('repo_url')) {
      this.#db.exec('ALTER TABLE projects ADD COLUMN repo_url TEXT');
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

    // Check if sessions table has the template chaining columns, add them if not
    // Re-fetch column info since table may have been recreated
    const updatedSessionsTableInfo = this.#db.prepare('PRAGMA table_info(sessions)').all();
    const updatedSessionsColumns = updatedSessionsTableInfo.map((col) => col.name);

    if (!updatedSessionsColumns.includes('next_template_id')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL');
    }
    if (!updatedSessionsColumns.includes('parent_session_id')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL');
    }

    // Create indexes for the template chaining columns (moved from schema.sql for migration compatibility)
    this.#db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_next_template ON sessions(next_template_id)');
    this.#db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)');

    // Check if message_attachments table has the file_path column, add it if not
    const attachmentsTableInfo = this.#db.prepare('PRAGMA table_info(message_attachments)').all();
    const attachmentsColumns = attachmentsTableInfo.map((col) => col.name);

    if (!attachmentsColumns.includes('file_path')) {
      this.#db.exec('ALTER TABLE message_attachments ADD COLUMN file_path TEXT');
    }

    // Migrate conversation_messages to add conversation_id column
    const messagesTableInfo = this.#db.prepare('PRAGMA table_info(conversation_messages)').all();
    const messagesColumns = messagesTableInfo.map((col) => col.name);

    if (!messagesColumns.includes('conversation_id')) {
      this.#db.exec('ALTER TABLE conversation_messages ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE');
      this.#db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id)');
    }

    // Create default conversations for existing sessions that don't have one
    this.#migrateExistingSessionsToConversations();

    // Migrate canvas_items table to add 'code' type
    this.#migrateCanvasItemsTypeConstraint();

    // Add claude_session_id column to conversations table for per-conversation context isolation
    const conversationsTableInfo = this.#db.prepare('PRAGMA table_info(conversations)').all();
    const conversationsColumns = conversationsTableInfo.map((col) => col.name);

    if (!conversationsColumns.includes('claude_session_id')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN claude_session_id TEXT');
    }

    // Add token usage columns to conversations table (Issue #175)
    // Re-fetch column info after potential claude_session_id migration
    const conversationsUsageTableInfo = this.#db.prepare('PRAGMA table_info(conversations)').all();
    const conversationsUsageColumns = conversationsUsageTableInfo.map((col) => col.name);

    if (!conversationsUsageColumns.includes('input_tokens')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN input_tokens INTEGER DEFAULT 0');
    }
    if (!conversationsUsageColumns.includes('output_tokens')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN output_tokens INTEGER DEFAULT 0');
    }
    if (!conversationsUsageColumns.includes('cache_read_input_tokens')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN cache_read_input_tokens INTEGER DEFAULT 0');
    }
    if (!conversationsUsageColumns.includes('cache_creation_input_tokens')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN cache_creation_input_tokens INTEGER DEFAULT 0');
    }
    if (!conversationsUsageColumns.includes('web_search_requests')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN web_search_requests INTEGER DEFAULT 0');
    }
    if (!conversationsUsageColumns.includes('context_window')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN context_window INTEGER DEFAULT 200000');
    }
    if (!conversationsUsageColumns.includes('model')) {
      this.#db.exec('ALTER TABLE conversations ADD COLUMN model TEXT');
    }

    // Token usage columns for sessions table (re-fetch column info)
    const sessionsUsageTableInfo = this.#db.prepare('PRAGMA table_info(sessions)').all();
    const sessionsUsageColumns = sessionsUsageTableInfo.map((col) => col.name);

    if (!sessionsUsageColumns.includes('input_tokens')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN input_tokens INTEGER DEFAULT 0');
    }
    if (!sessionsUsageColumns.includes('output_tokens')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN output_tokens INTEGER DEFAULT 0');
    }
    if (!sessionsUsageColumns.includes('cache_read_input_tokens')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN cache_read_input_tokens INTEGER DEFAULT 0');
    }
    if (!sessionsUsageColumns.includes('cache_creation_input_tokens')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN cache_creation_input_tokens INTEGER DEFAULT 0');
    }
    if (!sessionsUsageColumns.includes('web_search_requests')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN web_search_requests INTEGER DEFAULT 0');
    }
    if (!sessionsUsageColumns.includes('context_window')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN context_window INTEGER DEFAULT 200000');
    }

    // Check if sessions table has the archived column, add it if not
    // Re-fetch column info since table may have been recreated
    const finalSessionsTableInfo = this.#db.prepare('PRAGMA table_info(sessions)').all();
    const finalSessionsColumns = finalSessionsTableInfo.map((col) => col.name);

    if (!finalSessionsColumns.includes('archived')) {
      this.#db.exec('ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
      this.#db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived)');
    }
  }

  /**
   * Create default conversations for existing sessions that don't have any
   * and associate orphaned messages with the default conversation
   * @private
   */
  #migrateExistingSessionsToConversations() {
    // Find sessions that have messages but no conversations
    const sessionsWithoutConversations = this.#db.prepare(`
      SELECT DISTINCT s.id FROM sessions s
      LEFT JOIN conversations c ON c.session_id = s.id
      WHERE c.id IS NULL
      AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = s.id)
    `).all();

    for (const session of sessionsWithoutConversations) {
      // Create a default conversation for this session
      const convId = this.generateId();
      const now = Date.now();

      this.#db.prepare(`
        INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(convId, session.id, 'Initial', now, now);

      // Associate all existing messages with this conversation
      this.#db.prepare(`
        UPDATE conversation_messages SET conversation_id = ? WHERE session_id = ? AND conversation_id IS NULL
      `).run(convId, session.id);
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
        next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
        parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- Copy data from old table (explicitly list columns that exist in both tables)
      INSERT INTO sessions_new (id, project_id, name, status, mode, thinking_enabled, git_branch, git_worktree, pr_url, error, cost_usd, claude_session_id, model, created_at, updated_at)
      SELECT id, project_id, name, status, mode, thinking_enabled, git_branch, git_worktree, pr_url, error, cost_usd, claude_session_id, model, created_at, updated_at FROM sessions;

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
   * Migrate canvas_items table to include 'code' in type CHECK constraint
   * SQLite doesn't support ALTER TABLE to modify constraints, so we recreate the table
   * @private
   */
  #migrateCanvasItemsTypeConstraint() {
    // Check if the current constraint includes 'code' by reading from sqlite_master
    const tableSchema = this.#db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='canvas_items'")
      .get();

    // If schema includes 'code', no migration needed
    if (tableSchema?.sql?.includes("'code'")) {
      return;
    }

    // Need to recreate table with updated constraint
    this.#db.exec(`
      -- Create new table with updated constraint
      CREATE TABLE canvas_items_new (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json', 'pdf', 'code')),
        content TEXT,
        data TEXT,
        mime_type TEXT,
        filename TEXT,
        label TEXT,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      -- Copy data from old table
      INSERT INTO canvas_items_new SELECT * FROM canvas_items;

      -- Drop old table
      DROP TABLE canvas_items;

      -- Rename new table
      ALTER TABLE canvas_items_new RENAME TO canvas_items;

      -- Recreate index
      CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
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
