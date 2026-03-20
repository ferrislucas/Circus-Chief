/**
 * Migrations for miscellaneous tables: command_buttons, session_templates,
 * app_settings, providers, provider_models, agent_call_logs.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, tableExists } from './migrationUtils.js';

/**
 * Seed the built-in Anthropic provider if it doesn't exist.
 */
function seedBuiltInProvider(db) {
  const providerId = 'anthropic-default';

  const existing = db
    .prepare('SELECT id FROM providers WHERE id = ?')
    .get(providerId);

  if (!existing) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO providers (id, name, is_built_in, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`
    ).run(providerId, 'Anthropic (Official)', now, now);
  }

  // Seed default Anthropic models if they don't exist
  const defaultModels = [
    { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fast & lightweight', tier: 'haiku' },
    { id: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Balanced', tier: 'sonnet' },
    { id: 'anthropic-opus', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Most capable (default)', tier: 'opus' },
  ];

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();
  for (const model of defaultModels) {
    insertModel.run(model.id, providerId, model.modelId, model.displayName, model.description, model.tier, now);
  }
}

/**
 * Update built-in models to 4.6 versions.
 */
function updateBuiltInModels(db) {
  const providerId = 'anthropic-default';

  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?
     WHERE provider_id = ? AND id = ?`
  ).run('claude-sonnet-4-6', 'Sonnet 4.6', providerId, 'anthropic-sonnet');

  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?
     WHERE provider_id = ? AND id = ?`
  ).run('claude-opus-4-6', 'Opus 4.6', providerId, 'anthropic-opus');
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

  // --- Legacy model_providers cleanup ---
  {
    name: 'model_providers-cleanup-legacy',
    up(db) {
      const hasLegacyTable = tableExists(db, 'model_providers');
      if (hasLegacyTable) {
        db.exec('DROP TABLE IF EXISTS provider_models');
        db.exec('DROP TABLE IF EXISTS model_providers');
      }
    },
  },

  // --- Providers and provider_models tables ---
  {
    name: 'providers-create-tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT,
          auth_token TEXT,
          api_timeout_ms INTEGER,
          additional_env_vars TEXT,
          is_built_in INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS provider_models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          model_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          description TEXT,
          tier TEXT CHECK(tier IN ('opus', 'sonnet', 'haiku', 'custom')),
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
      `);
    },
  },

  // --- Seed built-in provider ---
  {
    name: 'providers-seed-built-in',
    up(db) { seedBuiltInProvider(db); },
  },

  // --- Update built-in models to 4.6 ---
  {
    name: 'providers-update-built-in-models',
    up(db) { updateBuiltInModels(db); },
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
];
