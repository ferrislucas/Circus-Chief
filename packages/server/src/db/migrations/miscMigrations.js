/**
 * Migrations for miscellaneous tables: command_buttons, session_templates,
 * app_settings, providers, provider_models, agent_call_logs.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, getColumns, tableExists } from './migrationUtils.js';
import { ACTIVITY_TRIGGER_CREATE_DDL } from './activityTriggers.js';

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
  // --- Workspace list activity column ---
  //
  // The workspace-card list query needs "when did anything in this workspace
  // last happen" as a sortable value. Computing that at read time (a
  // correlated subquery joining messages/summaries/command_runs per row) costs
  // O(total sessions in the project) on every list request regardless of page
  // size, because the sort key has to be known before LIMIT can apply.
  //
  // Instead, maintain `sessions.last_activity_at` as a denormalized column,
  // written once per activity event (by trigger, not by application code, so
  // no write path can forget it) and read as a plain column by the
  // aggregate query. The workspace list then only pays for MAX() over the
  // already-scanned tree rows, not an additional per-row fan-out.
  {
    name: 'workspace-list-activity-column',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'last_activity_at', 'INTEGER');

      // Give activity-free rows their creation time, so this expensive
      // backfill retires every row after its first run.
      db.exec(`
        UPDATE sessions
        SET last_activity_at = COALESCE((
          SELECT MAX(activity_at) FROM (
            SELECT MAX(timestamp) AS activity_at FROM conversation_messages WHERE session_id = sessions.id
            UNION ALL
            SELECT MAX(generated_at) FROM session_summaries WHERE session_id = sessions.id
            UNION ALL
            SELECT MAX(updated_at) FROM session_summaries WHERE session_id = sessions.id
            UNION ALL
            SELECT MAX(completed_at) FROM command_runs WHERE session_id = sessions.id
            UNION ALL
            SELECT MAX(started_at) FROM command_runs WHERE session_id = sessions.id
          )
        ), created_at)
        WHERE last_activity_at IS NULL
      `);

      db.exec(`${ACTIVITY_TRIGGER_CREATE_DDL.join(';\n')};`);
    },
  },

  // --- Command buttons ---
  {
    name: 'command_buttons-add-show_on_list',
    up(db) {
      addColumnIfMissing(db, 'command_buttons', 'show_on_list', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    name: 'command_runs-create-output-chunks',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS command_run_output_chunks (
          run_id TEXT NOT NULL REFERENCES command_runs(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          content TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          PRIMARY KEY (run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_command_run_output_chunks_run_sequence
          ON command_run_output_chunks(run_id, sequence);
      `);
    },
  },
  {
    name: 'command-runs-create-output-cleanup',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS command_run_output_cleanup (
          run_id TEXT PRIMARY KEY,
          working_directory TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE TRIGGER IF NOT EXISTS trg_command_run_output_cleanup
        BEFORE DELETE ON command_runs FOR EACH ROW BEGIN
          INSERT OR IGNORE INTO command_run_output_cleanup (run_id, working_directory)
          SELECT OLD.id, COALESCE(s.git_worktree, p.working_directory)
          FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = OLD.session_id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_session_command_output_cleanup
        BEFORE DELETE ON sessions FOR EACH ROW BEGIN
          INSERT OR IGNORE INTO command_run_output_cleanup (run_id, working_directory)
          SELECT cr.id, COALESCE(OLD.git_worktree, p.working_directory)
          FROM command_runs cr JOIN projects p ON p.id = OLD.project_id WHERE cr.session_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_button_command_output_cleanup
        BEFORE DELETE ON command_buttons FOR EACH ROW BEGIN
          INSERT OR IGNORE INTO command_run_output_cleanup (run_id, working_directory)
          SELECT cr.id, COALESCE(s.git_worktree, p.working_directory)
          FROM command_runs cr JOIN sessions s ON s.id = cr.session_id
          JOIN projects p ON p.id = s.project_id WHERE cr.button_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_project_command_output_cleanup
        BEFORE DELETE ON projects FOR EACH ROW BEGIN
          INSERT OR IGNORE INTO command_run_output_cleanup (run_id, working_directory)
          SELECT cr.id, COALESCE(s.git_worktree, OLD.working_directory)
          FROM command_runs cr JOIN sessions s ON s.id = cr.session_id WHERE s.project_id = OLD.id;
        END;
      `);
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
