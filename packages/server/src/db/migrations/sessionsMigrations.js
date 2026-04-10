/**
 * Migrations for the sessions table and closely related session tables.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, getColumns, getTableSql } from './migrationUtils.js';

// Table name constants for migrations
const TABLE_SESSIONS = 'sessions';

// Column type constants
const COL_INTEGER_DEFAULT_0 = 'INTEGER DEFAULT 0';

/**
 * Migrate sessions table to include 'stopped' and 'scheduled' in status CHECK constraint.
 * SQLite doesn't support ALTER TABLE to modify constraints, so we recreate the table.
 */
function migrateSessionsStatusConstraint(db) {
  const tableSql = getTableSql(db, TABLE_SESSIONS);

  // If schema already includes 'scheduled', no migration needed
  if (tableSql?.includes("'scheduled'")) {
    return;
  }

  // Get all columns from the current table to preserve data
  const columnNames = getColumns(db, TABLE_SESSIONS);

  const baseColumns = `
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'completed', 'error', 'scheduled')),
      mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('plan', 'standard', 'yolo')),
      thinking_enabled INTEGER NOT NULL DEFAULT 0,
      git_branch TEXT,
      git_worktree TEXT,
      pr_url TEXT,
      error TEXT,
      effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto')),
      cost_usd REAL DEFAULT 0,
      claude_session_id TEXT,
      model TEXT,
      next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
      parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_input_tokens INTEGER DEFAULT 0,
      cache_creation_input_tokens INTEGER DEFAULT 0,
      web_search_requests INTEGER DEFAULT 0,
      context_window INTEGER DEFAULT 200000,
      archived INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      manually_named INTEGER NOT NULL DEFAULT 0,
      scheduled_at INTEGER DEFAULT NULL,
      reschedule_delay_minutes INTEGER DEFAULT 15,
      auto_reschedule_enabled INTEGER DEFAULT 0,
      reschedule_on_token_limit INTEGER DEFAULT 1,
      reschedule_on_service_error INTEGER DEFAULT 1,
      max_reschedule_count INTEGER DEFAULT NULL,
      max_total_tokens INTEGER DEFAULT NULL,
      reschedule_count INTEGER DEFAULT 0,
      reschedule_at_token_count INTEGER DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  `;

  const selectColumns = [
    'id', 'project_id', 'name', 'status', 'mode', 'thinking_enabled',
    'git_branch', 'git_worktree', 'pr_url', 'error', 'effort_level',
    'cost_usd', 'claude_session_id', 'model', 'next_template_id',
    'parent_session_id', 'input_tokens', 'output_tokens',
    'cache_read_input_tokens', 'cache_creation_input_tokens',
    'web_search_requests', 'context_window', 'archived', 'starred',
    'manually_named', 'scheduled_at', 'reschedule_delay_minutes',
    'auto_reschedule_enabled', 'reschedule_on_token_limit',
    'reschedule_on_service_error', 'max_reschedule_count',
    'max_total_tokens', 'reschedule_count', 'reschedule_at_token_count',
    'created_at', 'updated_at',
  ]
    .filter((col) => columnNames.includes(col))
    .join(', ');

  db.exec(`
    CREATE TABLE sessions_new (
      ${baseColumns}
    );

    INSERT INTO sessions_new (${selectColumns})
    SELECT ${selectColumns} FROM sessions;

    DROP TABLE sessions;

    ALTER TABLE sessions_new RENAME TO sessions;

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived);
    CREATE INDEX IF NOT EXISTS idx_sessions_starred ON sessions(archived, starred);
    CREATE INDEX IF NOT EXISTS idx_sessions_next_template ON sessions(next_template_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(scheduled_at) WHERE scheduled_at IS NOT NULL;
  `);
}

/** @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>} */
export const sessionsMigrations = [
  // --- Initial sessions columns ---
  {
    name: 'sessions-add-cost_usd',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'cost_usd', 'REAL DEFAULT 0'); },
  },
  {
    name: 'sessions-add-claude_session_id',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'claude_session_id', 'TEXT'); },
  },
  {
    name: 'sessions-add-model',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'model', 'TEXT'); },
  },
  {
    name: 'sessions-add-provider_id-early',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'provider_id', 'TEXT'); },
  },
  {
    name: 'sessions-add-effort_level',
    up(db) {
      addColumnIfMissing(
        db, TABLE_SESSIONS, 'effort_level',
        "TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto'))"
      );
    },
  },

  // --- Scheduling columns ---
  {
    name: 'sessions-add-scheduled_at',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'scheduled_at', 'INTEGER DEFAULT NULL'); },
  },
  {
    name: 'sessions-add-reschedule_delay_minutes',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'reschedule_delay_minutes', 'INTEGER DEFAULT 15'); },
  },
  {
    name: 'sessions-add-auto_reschedule_enabled',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'auto_reschedule_enabled', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-reschedule_on_token_limit',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'reschedule_on_token_limit', 'INTEGER DEFAULT 1'); },
  },
  {
    name: 'sessions-add-reschedule_on_service_error',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'reschedule_on_service_error', 'INTEGER DEFAULT 1'); },
  },
  {
    name: 'sessions-add-max_reschedule_count',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'max_reschedule_count', 'INTEGER DEFAULT NULL'); },
  },
  {
    name: 'sessions-add-max_total_tokens',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'max_total_tokens', 'INTEGER DEFAULT NULL'); },
  },
  {
    name: 'sessions-add-reschedule_count',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'reschedule_count', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-reschedule_at_token_count',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'reschedule_at_token_count', 'INTEGER DEFAULT NULL'); },
  },

  // --- Status constraint migration (table recreation) ---
  {
    name: 'sessions-migrate-status-constraint',
    up(db) { migrateSessionsStatusConstraint(db); },
  },

  // --- Template chaining ---
  {
    name: 'sessions-add-next_template_id',
    up(db) {
      addColumnIfMissing(
        db, TABLE_SESSIONS, 'next_template_id',
        'TEXT REFERENCES session_templates(id) ON DELETE SET NULL'
      );
    },
  },
  {
    name: 'sessions-add-parent_session_id',
    up(db) {
      addColumnIfMissing(
        db, TABLE_SESSIONS, 'parent_session_id',
        'TEXT REFERENCES sessions(id) ON DELETE SET NULL'
      );
    },
  },
  {
    name: 'sessions-template-chaining-indexes',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_next_template ON sessions(next_template_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)');
    },
  },

  // --- Token usage columns ---
  {
    name: 'sessions-add-input_tokens',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'input_tokens', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-output_tokens',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'output_tokens', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-cache_read_input_tokens',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'cache_read_input_tokens', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-cache_creation_input_tokens',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'cache_creation_input_tokens', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-web_search_requests',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'web_search_requests', COL_INTEGER_DEFAULT_0); },
  },
  {
    name: 'sessions-add-context_window',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'context_window', 'INTEGER DEFAULT 200000'); },
  },

  // --- Archived / starred / manually_named ---
  {
    name: 'sessions-add-archived',
    up(db) {
      addColumnIfMissing(db, TABLE_SESSIONS, 'archived', 'INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived)');
    },
  },
  {
    name: 'sessions-add-starred',
    up(db) {
      addColumnIfMissing(db, TABLE_SESSIONS, 'starred', 'INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_starred ON sessions(archived, starred)');
    },
  },
  {
    name: 'sessions-add-manually_named',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'manually_named', 'INTEGER NOT NULL DEFAULT 0'); },
  },

  // --- Pending prompt / slash commands / pending model / auto send ---
  {
    name: 'sessions-add-pending_prompt',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'pending_prompt', 'TEXT'); },
  },
  {
    name: 'sessions-add-slash_commands',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'slash_commands', 'TEXT'); },
  },
  {
    name: 'sessions-add-pending_model',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'pending_model', 'TEXT'); },
  },
  {
    name: 'sessions-add-auto_send_pending_prompt',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'auto_send_pending_prompt', COL_INTEGER_DEFAULT_0); },
  },

  // --- Provider ID (from providers table, added later in sequence) ---
  {
    name: 'sessions-add-provider_id-from-providers',
    up(db) {
      addColumnIfMissing(db, TABLE_SESSIONS, 'provider_id', 'TEXT REFERENCES providers(id)');
    },
  },

  // --- Agent type ---
  {
    name: 'sessions-add-agent_type',
    up(db) { addColumnIfMissing(db, TABLE_SESSIONS, 'agent_type', "TEXT DEFAULT 'claude-code'"); },
  },
];
