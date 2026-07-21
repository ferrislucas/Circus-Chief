/**
 * Migrations for miscellaneous tables: command_buttons, session_templates,
 * app_settings, providers, provider_models, agent_call_logs.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, getColumns, tableExists } from './migrationUtils.js';

/**
 * Prompt strings for the default global session templates.
 * Re-exported from defaultSessionTemplates for backward compatibility.
 */
export { DEFAULT_SESSION_TEMPLATE_PROMPTS } from '../defaultSessionTemplates.js';

/**
 * Stale Claude model-id aliases → current ids.
 *
 * These are ids that used to identify a built-in Anthropic model but were
 * retired when the catalog was bumped (e.g. claude-sonnet-4-6 → claude-sonnet-5).
 * Config that still references a retired id will silently spawn/launch on the
 * wrong model, so we rewrite them. Only CONFIG columns are normalized — see
 * CONFIG_MODEL_COLUMNS — never record/audit columns (sessions.model, etc.),
 * which must reflect what actually ran.
 */
export const STALE_CLAUDE_MODEL_IDS = Object.freeze({
  // Sonnet family → current Sonnet 5
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-5',
  'claude-sonnet-4-20250514': 'claude-sonnet-5',
  'sonnet': 'claude-sonnet-5',
  // Opus orphan → current default Opus 4.8 (4-6/4-7/4-8 remain valid)
  'claude-opus-4-5-20251101': 'claude-opus-4-8',
  'opus 4.8': 'claude-opus-4-8',
  // Haiku alias → current Haiku
  'haiku': 'claude-haiku-4-5-20251001',
});

/**
 * CONFIG columns that hold forward-looking model intent. Only these are
 * normalized. Record columns (sessions.model, sessions.pending_model,
 * conversations.model, conversation_messages.model, agent_call_logs.model)
 * are deliberately excluded — they are historical/audit data.
 */
export const CONFIG_MODEL_COLUMNS = Object.freeze([
  ['kanban_lanes', 'on_enter_model'],
  ['session_templates', 'model'],
  ['project_session_defaults', 'model'],
]);

/**
 * Rewrite stale Claude model ids in config columns to their current ids.
 * Idempotent: each UPDATE's WHERE no longer matches after the first run.
 * @param {import('better-sqlite3').Database} db
 */
export function normalizeStaleClaudeModelIds(db) {
  for (const [table, col] of CONFIG_MODEL_COLUMNS) {
    if (!tableExists(db, table)) continue;
    if (!getColumns(db, table).includes(col)) continue;
    const update = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);
    for (const [oldId, newId] of Object.entries(STALE_CLAUDE_MODEL_IDS)) {
      update.run(newId, oldId);
    }
  }
}

/** @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>} */
export const miscMigrations = [
  // --- Command buttons ---
  {
    name: 'command_buttons-add-show_on_list',
    up(db) {
      addColumnIfMissing(db, 'command_buttons', 'show_on_list', 'INTEGER NOT NULL DEFAULT 0');
    },
  },

  // --- Session templates ---
  {
    name: 'session_templates-add-model',
    up(db) { addColumnIfMissing(db, 'session_templates', 'model', 'TEXT'); },
  },
  {
    name: 'session_templates-add-mode',
    up(db) {
      addColumnIfMissing(
        db, 'session_templates', 'mode',
        "TEXT DEFAULT 'yolo' CHECK(mode IN ('plan', 'standard', 'yolo'))"
      );
    },
  },
  {
    name: 'session_templates-add-effort_level',
    up(db) {
      addColumnIfMissing(
        db, 'session_templates', 'effort_level',
        "TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto'))"
      );
    },
  },
  {
    name: 'session_templates-add-quick-response-fields',
    up(db) {
      addColumnIfMissing(db, 'session_templates', 'show_in_quick_responses', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'session_templates', 'quick_response_auto_submit', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'session_templates', 'quick_response_sort_order', 'INTEGER NOT NULL DEFAULT 0');
    },
  },

  // --- App settings table ---
  {
    name: 'app_settings-create-table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    },
  },

  // --- Agent call logs table ---
  {
    name: 'agent_call_logs-create-table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_call_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          conversation_id TEXT,
          agent_type TEXT NOT NULL,
          model TEXT,
          call_type TEXT NOT NULL,
          prompt_length INTEGER,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          thinking_tokens INTEGER DEFAULT 0,
          cache_read_tokens INTEGER DEFAULT 0,
          cache_write_tokens INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          duration_ms INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'streaming', 'completed', 'error')),
          error_message TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_session ON agent_call_logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_started ON agent_call_logs(started_at);
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_agent_type ON agent_call_logs(agent_type);
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_call_type ON agent_call_logs(call_type);
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_status ON agent_call_logs(status);
        CREATE INDEX IF NOT EXISTS idx_agent_call_logs_model ON agent_call_logs(model);
      `);
    },
  },

  // --- Model-id normalization (config columns only) ---
  {
    name: 'normalize-stale-claude-model-ids',
    up(db) { normalizeStaleClaudeModelIds(db); },
  },
];
