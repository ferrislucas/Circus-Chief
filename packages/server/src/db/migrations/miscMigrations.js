/**
 * Migrations for miscellaneous tables: command_buttons, session_templates,
 * app_settings, providers, provider_models, agent_call_logs.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing } from './migrationUtils.js';

/**
 * Prompt strings for the default global session templates.
 * Re-exported from defaultSessionTemplates for backward compatibility.
 */
export { DEFAULT_SESSION_TEMPLATE_PROMPTS } from '../defaultSessionTemplates.js';

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
      addColumnIfMissing(db, 'session_templates', 'legacy_quick_response_id', 'TEXT');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_templates_legacy_quick_response_id
        ON session_templates(legacy_quick_response_id)
        WHERE legacy_quick_response_id IS NOT NULL
      `);
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

  // --- Remove template rows that were created by the legacy quick-response
  //     conversion migration. These rows have a non-null legacy_quick_response_id
  //     and are the root cause of the duplicate quick-response items users see.
  //     Templates created directly by users (legacy_quick_response_id IS NULL)
  //     are left untouched.
  {
    name: 'session_templates-remove-legacy-quick-response-templates',
    up(db) {
      db.prepare(
        'DELETE FROM session_templates WHERE legacy_quick_response_id IS NOT NULL'
      ).run();
    },
  },

  // --- Add a UNIQUE index on (name) for global templates (project_id IS NULL).
  //     Pre-flight: delete any duplicate global-name rows that would violate the
  //     new constraint, keeping the row with the smallest created_at (i.e. oldest).
  //     The index is partial so project-scoped templates can freely share names.
  {
    name: 'session_templates-add-global-name-unique-index',
    up(db) {
      // Remove duplicates: for each name collision among global templates, keep
      // the row with the lowest created_at (ties broken by lowest rowid).
      db.exec(`
        DELETE FROM session_templates
        WHERE project_id IS NULL
          AND id NOT IN (
            SELECT id
            FROM session_templates AS outer_t
            WHERE outer_t.project_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM session_templates AS inner_t
                WHERE inner_t.project_id IS NULL
                  AND inner_t.name = outer_t.name
                  AND (
                    inner_t.created_at < outer_t.created_at
                    OR (inner_t.created_at = outer_t.created_at
                        AND inner_t.rowid < outer_t.rowid)
                  )
              )
          )
      `);

      // Create the partial unique index (idempotent).
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_templates_global_name
        ON session_templates(name)
        WHERE project_id IS NULL
      `);
    },
  },
];
