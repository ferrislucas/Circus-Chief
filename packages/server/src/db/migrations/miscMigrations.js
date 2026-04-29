/**
 * Migrations for miscellaneous tables: command_buttons, session_templates,
 * app_settings, providers, provider_models, agent_call_logs.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { randomUUID } from 'node:crypto';
import { OPENAI_MODELS } from '@circuschief/shared';
import { addColumnIfMissing, tableExists } from './migrationUtils.js';

/**
 * Seed the built-in Anthropic provider if it doesn't exist.
 */
function seedBuiltInAnthropicProvider(db) {
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
    { id: 'anthropic-opus', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Previous generation', tier: 'opus' },
    { id: 'anthropic-opus-4-7', modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Most capable (default)', tier: 'opus' },
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
 * Seed the built-in OpenAI/Codex provider if it doesn't exist.
 */
function seedBuiltInOpenAIProvider(db) {
  const providerId = 'openai-default';
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'openai', 1, ?, ?)`
  ).run(providerId, 'OpenAI (Official)', now, now);

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', ?)`
  );

  for (const model of OPENAI_MODELS) {
    insertModel.run(model.seedId, providerId, model.id, model.name, model.description, now);
  }
}

function seedBuiltInProviders(db) {
  seedBuiltInAnthropicProvider(db);
  seedBuiltInOpenAIProvider(db);
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

/**
 * Prompt strings for the default global session templates.
 * Exported so tests can assert verbatim equality.
 */
export const DEFAULT_SESSION_TEMPLATE_PROMPTS = {
  REVIEW: `Review the plan on the canvas. If there's more than one plan then review the most recently updated plan. if there are no plans on the canvas then look for the most recently updated plan on the root session canvas.

Make sure there are tests explicitly called out for all changes. Make sure that all context necessary to hand off the task is included in the plan.

Are there any gaps in the plan? Is test coverage spelled out explicitly? Does the code match the assumptions in the plan?

Update the plan according to your review recommendations.`,
  IMPLEMENT: `Implement the plan on the canvas. If there's more than one plan on the canvas then use the most recently updated plan. If you don't see a plan on the canvas then look at the parent session's canvas.`,
  PR: `Ensure all relevant changes are committed and pushed. Then determine the session's goals. You can typically find details about the goals of the session by looking at the most recently modified markdown documents on the root session's canvas - these are typically plans that were implemented during the session. You can also look at the root session's summary, but don't trigger a new summary to be created if the summary is missing.

Create a draft pr and ensure all changes are committed and pushed.`,
};

/**
 * Seed default global session templates when no global template exists.
 * Idempotent: if any global session template already exists, does nothing.
 */
function seedDefaultSessionTemplates(db) {
  const count = db.prepare(
    'SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL'
  ).get().cnt;
  if (count > 0) return;

  const defaults = [
    { name: 'Review the plan', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW },
    { name: 'Implement the plan on the canvas', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT },
    { name: 'Create/update PR', prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PR },
  ];

  const stmt = db.prepare(`
    INSERT INTO session_templates (
      id, project_id, name, prompt,
      next_template_id, thinking_enabled,
      git_branch, git_mode, model, mode, effort_level, target_lane_id,
      created_at, updated_at
    ) VALUES (?, NULL, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, NULL, ?, ?)
  `);

  const now = Date.now();
  for (const item of defaults) {
    stmt.run(randomUUID(), item.name, item.prompt, now, now);
  }
}

/**
 * Seed default global quick responses when the table is empty.
 */
function seedDefaultQuickResponses(db) {
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
  if (count > 0) return;

  const defaults = [
    { label: 'Put a plan on the canvas', content: 'Put a plan on the canvas to get this done', autoSubmit: false, sortOrder: 0 },
    { label: 'Yes', content: 'Yes', autoSubmit: true, sortOrder: 1 },
    { label: 'Review the plan', content: `Review the plan on the canvas. Are there any issues that you can find? Is test coverage specified explicitly enough? Does the current code match the assumptions in the plan?\n\nList the issues that you find and then update the plan on the canvas to address any issues that you find. Don't talk about issues with the original plan in the plan itself. Just tell me what the issues are, and update the plan so that the plan doesn't have the issues.`, autoSubmit: true, sortOrder: 2 },
    { label: 'Implement the plan on the canvas', content: 'Implement the plan on the canvas', autoSubmit: true, sortOrder: 3 },
    { label: 'Create / Update PR', content: `Ensure all relevant changes are committed and pushed. Then look at the session's summary and create a draft PR if no PR already exists.`, autoSubmit: true, sortOrder: 4 },
    { label: 'Review PR', content: 'Look at the PR related to the root session. Review the PR. Are there any issues? Are best practices adhered to? Does the PR accomplish the goal? Are all changes covered by tests?', autoSubmit: true, sortOrder: 5 },
    { label: 'Add tests', content: 'Inspect the changes on our branch. For each change, ensure we have tests that assert the change is working in the expected way. Implement the tests.', autoSubmit: true, sortOrder: 6 },
    { label: 'Merge in main', content: 'Merge in the latest main branch', autoSubmit: true, sortOrder: 7 },
    { label: 'Add tests to the plan', content: 'Call out specific test cases in the plan, we should have an assertion for each change called for in the plan', autoSubmit: true, sortOrder: 8 },
    { label: 'Tests are failing', content: 'Tests are failing. Look at the canvas for details', autoSubmit: true, sortOrder: 9 },
    { label: 'Continue', content: 'Continue', autoSubmit: true, sortOrder: 10 },
  ];

  const stmt = db.prepare(
    `INSERT INTO quick_responses
     (id, project_id, label, content, auto_submit, category, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();
  for (const item of defaults) {
    stmt.run(randomUUID(), null, item.label, item.content, item.autoSubmit ? 1 : 0, null, item.sortOrder, now, now);
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
          commit_attribution_override TEXT,
          is_built_in INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai')),
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

  // --- Add `kind` column to providers (for DBs that predate the CREATE TABLE change) ---
  {
    name: 'providers-add-kind',
    up(db) {
      addColumnIfMissing(
        db,
        'providers',
        'kind',
        "TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai'))"
      );
    },
  },

  {
    name: 'providers-add-commit_attribution_override',
    up(db) {
      addColumnIfMissing(db, 'providers', 'commit_attribution_override', 'TEXT');
    },
  },

  // --- Seed built-in providers ---
  {
    name: 'providers-seed-built-in',
    up(db) { seedBuiltInProviders(db); },
  },

  // --- Seed built-in OpenAI provider for DBs that already ran the original seed ---
  {
    name: 'providers-seed-built-in-openai',
    up(db) { seedBuiltInOpenAIProvider(db); },
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

  // --- Seed default global quick responses ---
  {
    name: 'quick_responses-seed-defaults',
    up(db) { seedDefaultQuickResponses(db); },
  },

  // --- Seed default global session templates ---
  {
    name: 'session_templates-seed-defaults',
    up(db) { seedDefaultSessionTemplates(db); },
  },

  // --- Add Opus 4.7 as a new built-in model (keep Opus 4.6 for existing sessions) ---
  {
    name: 'providers-update-built-in-opus-4-7',
    up(db) {
      const providerId = 'anthropic-default';

      // Mark existing Opus 4.6 row as previous generation
      db.prepare(
        `UPDATE provider_models
         SET description = ?
         WHERE provider_id = ? AND id = ?`
      ).run('Previous generation', providerId, 'anthropic-opus');

      // Insert new Opus 4.7 row (OR IGNORE in case seed already created it)
      db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('anthropic-opus-4-7', providerId, 'claude-opus-4-7', 'Opus 4.7', 'Most capable (default)', 'opus', Date.now());
    },
  },
];
