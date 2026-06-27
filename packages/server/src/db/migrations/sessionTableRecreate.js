/**
 * Helper for recreating the sessions table during migrations that change
 * column defaults or constraints (SQLite requires table recreation for these).
 */
import { getColumns } from './migrationUtils.js';

const TABLE_SESSIONS = 'sessions';

const SESSIONS_TARGET_MODE_DEFAULT = "'yolo'";
const SESSIONS_TARGET_THINKING_ENABLED_DEFAULT = '1';

/**
 * SQL column definitions for the sessions table with current defaults.
 */
export const SESSIONS_ALL_CURRENT_COLUMNS = `
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'completed', 'error', 'scheduled')),
    mode TEXT NOT NULL DEFAULT 'yolo' CHECK (mode IN ('plan', 'standard', 'yolo')),
    thinking_enabled INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    git_branch TEXT,
    git_worktree TEXT,
    pr_url TEXT,
    error TEXT,
    effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto')),
    cost_usd REAL DEFAULT 0,
    claude_session_id TEXT,
    model TEXT,
    provider_id TEXT,
    next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
    parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    thinking_tokens INTEGER DEFAULT 0,
    cache_read_input_tokens INTEGER DEFAULT 0,
    cache_creation_input_tokens INTEGER DEFAULT 0,
    web_search_requests INTEGER DEFAULT 0,
    context_window INTEGER DEFAULT 200000,
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
    pending_prompt TEXT,
    slash_commands TEXT,
    pending_model TEXT,
    auto_send_pending_prompt INTEGER DEFAULT 0,
    agent_type TEXT DEFAULT 'claude-code',
    lane_trigger_depth INTEGER NOT NULL DEFAULT 0,
    pending_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
`;

export const SESSIONS_ALL_CURRENT_COLUMN_NAMES = [
  'id', 'project_id', 'name', 'status', 'mode', 'thinking_enabled',
  'archived', 'git_branch', 'git_worktree', 'pr_url', 'error',
  'effort_level', 'cost_usd', 'claude_session_id', 'model', 'provider_id',
  'next_template_id', 'parent_session_id', 'input_tokens', 'output_tokens',
  'thinking_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
  'web_search_requests', 'context_window', 'starred', 'manually_named',
  'scheduled_at', 'reschedule_delay_minutes', 'auto_reschedule_enabled',
  'reschedule_on_token_limit', 'reschedule_on_service_error',
  'max_reschedule_count', 'max_total_tokens', 'reschedule_count',
  'reschedule_at_token_count', 'pending_prompt', 'slash_commands',
  'pending_model', 'auto_send_pending_prompt', 'agent_type',
  'lane_trigger_depth', 'pending_conversation_id', 'created_at', 'updated_at',
];

/**
 * Recreate the sessions table with the given column SQL, preserving existing data.
 * @param {import('better-sqlite3').Database} db
 * @param {string} columnsSql
 * @param {string[]} allColumnNames
 */
export function recreateSessionsTable(db, columnsSql, allColumnNames) {
  const existingColumnNames = getColumns(db, TABLE_SESSIONS);
  const selectColumns = allColumnNames
    .filter((col) => existingColumnNames.includes(col))
    .join(', ');

  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');

  try {
    db.exec(`
      CREATE TABLE sessions_new (${columnsSql});
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

    const foreignKeyViolations = db.pragma('foreign_key_check');
    if (foreignKeyViolations.length > 0) {
      throw new Error('sessions table migration failed foreign key check');
    }
  } finally {
    db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

/**
 * Migrate sessions table defaults: mode → 'yolo', thinking_enabled → 1.
 * No-op if the table already has the target defaults.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateSessionsDefaultModeAndThinking(db) {
  const columns = db.prepare(`PRAGMA table_info(${TABLE_SESSIONS})`).all();
  const modeColumn = columns.find((col) => col.name === 'mode');
  const thinkingEnabledColumn = columns.find((col) => col.name === 'thinking_enabled');

  if (
    modeColumn?.dflt_value === SESSIONS_TARGET_MODE_DEFAULT
    && thinkingEnabledColumn?.dflt_value === SESSIONS_TARGET_THINKING_ENABLED_DEFAULT
  ) {
    return;
  }

  recreateSessionsTable(db, SESSIONS_ALL_CURRENT_COLUMNS, SESSIONS_ALL_CURRENT_COLUMN_NAMES);
}
