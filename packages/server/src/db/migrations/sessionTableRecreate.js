/**
 * Helper for recreating the sessions table during migrations that change
 * column defaults or constraints (SQLite requires table recreation for these).
 */
import { getColumns } from './migrationUtils.js';

const TABLE_SESSIONS = 'sessions';

const SESSIONS_TARGET_MODE_DEFAULT = "'yolo'";
const SESSIONS_TARGET_THINKING_ENABLED_DEFAULT = '1';

// Keep table recreation in lockstep with schema.sql. SQLite drops a table's
// indexes during recreation, so every sessions index must be restored here.
export const SESSIONS_INDEX_DDL = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_starred ON sessions(archived, starred)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_next_template ON sessions(next_template_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(scheduled_at) WHERE scheduled_at IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_sessions_lane_run ON sessions(lane_run_id)',
];

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
    parent_session_id TEXT REFERENCES sessions(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
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
    lane_run_id TEXT,
    own_work_state TEXT NOT NULL DEFAULT 'open',
    workflow_turn_token TEXT,
    completion_requested_turn_token TEXT,
    completion_request_key TEXT,
    completion_requested_at INTEGER,
    own_work_closed_at INTEGER,
    workflow_updated_at INTEGER,
    workflow_reason TEXT,
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
  'lane_run_id', 'own_work_state', 'workflow_turn_token',
  'completion_requested_turn_token', 'completion_request_key',
  'completion_requested_at', 'own_work_closed_at', 'workflow_updated_at',
  'workflow_reason',
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
      ${SESSIONS_INDEX_DDL.join(';\n      ')};
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
 * Name of the trigger that enforces immutable session parentage.
 * Exported so tests/migrations can reference it without duplicating the string.
 */
export const PARENT_IMMUTABILITY_TRIGGER = 'trg_sessions_parent_session_id_immutable';

/**
 * Create (idempotently) the trigger that rejects any UPDATE changing a
 * non-null parent_session_id. A one-time NULL -> value backfill is allowed;
 * value -> different-value and value -> NULL are both rejected.
 * @param {import('better-sqlite3').Database} db
 */
export function createParentImmutabilityTrigger(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS ${PARENT_IMMUTABILITY_TRIGGER};
    CREATE TRIGGER ${PARENT_IMMUTABILITY_TRIGGER}
    BEFORE UPDATE OF parent_session_id ON sessions
    FOR EACH ROW
    WHEN OLD.parent_session_id IS NOT NULL
      AND (NEW.parent_session_id IS NULL OR NEW.parent_session_id <> OLD.parent_session_id)
    BEGIN
      SELECT RAISE(ABORT, 'parent_session_id is immutable once set');
    END;
  `);
}

/**
 * Migrate the sessions table so that:
 *  - parent_session_id uses deferred ON DELETE NO ACTION (instead of SET NULL), and
 *  - a trigger rejects any attempt to change a non-null parent_session_id.
 * NO ACTION preserves the no-orphan invariant while allowing a project delete
 * to cascade through an entire session tree. RESTRICT cannot be used here
 * because SQLite applies it immediately, even on a deferred foreign key.
 * No-op (besides re-asserting the trigger) if the table already has the
 * target foreign-key behavior.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateSessionsImmutableParentage(db) {
  const parentFkAlreadyImmutable = db
    .pragma('foreign_key_list(sessions)')
    .some((fk) => fk.table === 'sessions' && fk.from === 'parent_session_id' && fk.on_delete === 'NO ACTION');

  if (!parentFkAlreadyImmutable) {
    recreateSessionsTable(db, SESSIONS_ALL_CURRENT_COLUMNS, SESSIONS_ALL_CURRENT_COLUMN_NAMES);
  }

  // Always (re)assert the trigger: it's cheap, idempotent, and must survive
  // any other table-recreate migration that rebuilds `sessions` without it.
  createParentImmutabilityTrigger(db);
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
