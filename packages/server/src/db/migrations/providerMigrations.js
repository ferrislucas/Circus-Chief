import { OPENAI_MODELS, GEMINI_MODELS } from '@circuschief/shared';
import { addColumnIfMissing, tableExists } from './migrationUtils.js';

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

function seedBuiltInGoogleProvider(db) {
  const providerId = 'google-default';
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'google', 1, ?, ?)`
  ).run(providerId, 'Google (Official)', now, now);

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', ?)`
  );

  for (const model of GEMINI_MODELS) {
    insertModel.run(model.seedId, providerId, model.id, model.name, model.description, now);
  }
}

function seedBuiltInProviders(db) {
  seedBuiltInAnthropicProvider(db);
  seedBuiltInOpenAIProvider(db);
}

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

export const providerMigrations = [
  {
    name: 'model_providers-cleanup-legacy',
    up(db) {
      if (tableExists(db, 'model_providers')) {
        db.exec('DROP TABLE IF EXISTS provider_models');
        db.exec('DROP TABLE IF EXISTS model_providers');
      }
    },
  },
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
          kind TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai','google')),
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
  {
    name: 'providers-add-kind',
    up(db) {
      addColumnIfMissing(
        db,
        'providers',
        'kind',
        "TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai','google'))"
      );
    },
  },
  {
    name: 'providers-add-commit_attribution_override',
    up(db) {
      addColumnIfMissing(db, 'providers', 'commit_attribution_override', 'TEXT');
    },
  },
  {
    name: 'providers-seed-built-in',
    up(db) { seedBuiltInProviders(db); },
  },
  {
    name: 'providers-seed-built-in-openai',
    up(db) { seedBuiltInOpenAIProvider(db); },
  },
  {
    name: 'providers-update-built-in-models',
    up(db) { updateBuiltInModels(db); },
  },
  {
    name: 'providers-update-built-in-opus-4-7',
    up(db) {
      const providerId = 'anthropic-default';

      db.prepare(
        `UPDATE provider_models
         SET description = ?
         WHERE provider_id = ? AND id = ?`
      ).run('Previous generation', providerId, 'anthropic-opus');

      db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('anthropic-opus-4-7', providerId, 'claude-opus-4-7', 'Opus 4.7', 'Most capable (default)', 'opus', Date.now());
    },
  },
  {
    name: 'providers-widen-kind-check-google',
    up(db) {
      // SQLite CHECK constraints are baked into the table definition and can't
      // be altered in-place. Recreate the table with the wider CHECK.
      //
      // IMPORTANT: Disable foreign key enforcement during the table swap.
      // provider_models has ON DELETE CASCADE referencing providers. SQLite
      // fires that cascade when DROP TABLE deletes parent rows, which would
      // wipe all provider_models data. Disabling FK enforcement prevents the
      // cascade. We re-enable it immediately after the rename.
      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS providers_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            base_url TEXT,
            auth_token TEXT,
            api_timeout_ms INTEGER,
            additional_env_vars TEXT,
            commit_attribution_override TEXT,
            is_built_in INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai','google')),
            created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
          );

          INSERT OR IGNORE INTO providers_new SELECT * FROM providers;

          DROP TABLE providers;

          ALTER TABLE providers_new RENAME TO providers;

          CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
        `);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    },
  },
  {
    name: 'providers-seed-built-in-google',
    up(db) { seedBuiltInGoogleProvider(db); },
  },
  {
    name: 'providers-update-gemini-flash-lite-model',
    up(db) {
      // The preview model 'gemini-2.5-flash-lite-preview-06-17' has been
      // removed by Google. Update to the stable GA model ID.
      db.prepare(
        `UPDATE provider_models
         SET model_id = ?, description = ?
         WHERE id = ? AND provider_id = ?`
      ).run('gemini-2.5-flash-lite', 'Lightweight & cost-efficient', 'google-gemini-2-5-flash-lite', 'google-default');

      // Also update any sessions that were using the old model ID
      db.prepare(
        `UPDATE sessions
         SET model = ?
         WHERE model = ?`
      ).run('gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview-06-17');
    },
  },
];
