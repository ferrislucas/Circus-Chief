import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS } from '@circuschief/shared';
import { getTableSql } from './migrationUtils.js';
import { BUILT_IN_OPENAI_COMMIT_ATTRIBUTION } from '../seedBaselineData.js';

const ANTHROPIC_PROVIDER_ID = 'anthropic-default';
const OPENAI_PROVIDER_ID = 'openai-default';
const GOOGLE_PROVIDER_ID = 'google-default';
const FABLE_MODEL = {
  id: 'anthropic-fable',
  modelId: 'claude-fable-5',
  displayName: 'Fable 5',
  description: 'Next-generation intelligence',
  tier: 'fable',
};

export function seedBuiltInAnthropicProvider(db) {
  const existing = db
    .prepare('SELECT id FROM providers WHERE id = ?')
    .get(ANTHROPIC_PROVIDER_ID);

  if (!existing) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO providers (id, name, is_built_in, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`
    ).run(ANTHROPIC_PROVIDER_ID, 'Anthropic (Official)', now, now);
  }

  const defaultModels = [
    FABLE_MODEL,
    { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fast & lightweight', tier: 'haiku' },
    { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', description: 'Balanced', tier: 'sonnet' },
    { id: 'anthropic-opus', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Previous generation', tier: 'opus' },
    { id: 'anthropic-opus-4-7', modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Previous generation', tier: 'opus' },
    { id: 'anthropic-opus-4-8', modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Most capable (default)', tier: 'opus' },
  ];

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();
  for (const model of defaultModels) {
    insertModel.run(model.id, ANTHROPIC_PROVIDER_ID, model.modelId, model.displayName, model.description, model.tier, now);
  }
}

/**
 * Seed (and backfill) the built-in OpenAI provider and its model rows.
 *
 * This runs as the `providers-seed-built-in-openai` migration, and migrations
 * re-run unconditionally on every startup (see DatabaseManager#runMigrations).
 * That re-run is the upgrade/backfill path: because the model inserts use
 * `INSERT OR IGNORE` and iterate the *current* `OPENAI_MODELS` list, existing
 * databases automatically gain newly added built-in models (e.g. the GPT-5.6
 * family) on next startup without a dedicated migration. Models removed from
 * `OPENAI_MODELS` (e.g. the retired `gpt-5.5`) are intentionally NOT deleted
 * here — existing rows are left in place for runtime compatibility and hidden
 * from new-selection UI instead.
 *
 * NOTE: this backfill relies on migrations running every startup. If that ever
 * changes to run-once/versioned migrations, add an explicit backfill migration
 * for newly added built-in models.
 */
export function seedBuiltInOpenAIProvider(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, commit_attribution_override, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'openai', ?, 1, ?, ?)`
  ).run(OPENAI_PROVIDER_ID, 'OpenAI (Official)', BUILT_IN_OPENAI_COMMIT_ATTRIBUTION, now, now);

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', ?)`
  );

  for (const model of OPENAI_MODELS) {
    insertModel.run(model.seedId, OPENAI_PROVIDER_ID, model.id, model.name, model.description, now);
  }
}

export function seedBuiltInGoogleProvider(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'google', 1, ?, ?)`
  ).run(GOOGLE_PROVIDER_ID, 'Google (Official)', now, now);

  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', ?)`
  );

  for (const model of GEMINI_MODELS) {
    insertModel.run(model.seedId, GOOGLE_PROVIDER_ID, model.id, model.name, model.description, now);
  }
}

export function seedBuiltInProviders(db) {
  seedBuiltInAnthropicProvider(db);
  seedBuiltInOpenAIProvider(db);
}

export function backfillBuiltInOpenAIAttribution(db) {
  db.prepare(
    `UPDATE providers
     SET commit_attribution_override = ?, updated_at = ?
     WHERE id = ?
       AND is_built_in = 1
       AND kind = 'openai'
       AND commit_attribution_override IS NULL`
  ).run(BUILT_IN_OPENAI_COMMIT_ATTRIBUTION, Date.now(), OPENAI_PROVIDER_ID);
}

export function updateBuiltInModels(db) {
  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?
     WHERE provider_id = ? AND id = ?`
  ).run('claude-sonnet-5', 'Sonnet 5', ANTHROPIC_PROVIDER_ID, 'anthropic-sonnet');

  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?
     WHERE provider_id = ? AND id = ?`
  ).run('claude-opus-4-6', 'Opus 4.6', ANTHROPIC_PROVIDER_ID, 'anthropic-opus');
}

export function updateBuiltInSonnet5(db) {
  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?
     WHERE provider_id = ? AND id = ?`
  ).run('claude-sonnet-5', 'Sonnet 5', ANTHROPIC_PROVIDER_ID, 'anthropic-sonnet');
}

export function widenProviderModelsTierCheckForFable(db) {
  const existingSql = getTableSql(db, 'provider_models') || '';
  if (!existingSql || existingSql.includes("'fable'")) {
    return;
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_models_new (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        tier TEXT CHECK(tier IN ('fable', 'opus', 'sonnet', 'haiku', 'custom')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      INSERT OR IGNORE INTO provider_models_new (
        id, provider_id, model_id, display_name, description, tier, created_at
      )
      SELECT id, provider_id, model_id, display_name, description, tier, created_at
      FROM provider_models;

      DROP TABLE provider_models;

      ALTER TABLE provider_models_new RENAME TO provider_models;

      CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function seedBuiltInFable5(db) {
  widenProviderModelsTierCheckForFable(db);

  db.prepare(
    `INSERT OR IGNORE INTO provider_models (
       id, provider_id, model_id, display_name, description, tier, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FABLE_MODEL.id,
    ANTHROPIC_PROVIDER_ID,
    FABLE_MODEL.modelId,
    FABLE_MODEL.displayName,
    FABLE_MODEL.description,
    FABLE_MODEL.tier,
    Date.now()
  );

  db.prepare(
    `UPDATE provider_models
     SET model_id = ?, display_name = ?, description = ?, tier = ?
     WHERE provider_id = ? AND id = ?`
  ).run(
    FABLE_MODEL.modelId,
    FABLE_MODEL.displayName,
    FABLE_MODEL.description,
    FABLE_MODEL.tier,
    ANTHROPIC_PROVIDER_ID,
    FABLE_MODEL.id
  );
}

/** Seed current catalogs after enabled/sort_order columns have been added. */
export function syncBuiltInModelCatalogs(db) {
  const now = Date.now();
  const anthropicSeedIds = {
    'claude-fable-5': 'anthropic-fable',
    'claude-haiku-4-5-20251001': 'anthropic-haiku',
    'claude-sonnet-5': 'anthropic-sonnet',
    'claude-opus-4-6': 'anthropic-opus',
    'claude-opus-4-7': 'anthropic-opus-4-7',
    'claude-opus-4-8': 'anthropic-opus-4-8',
  };
  const catalogs = [
    [ANTHROPIC_PROVIDER_ID, CLAUDE_MODELS, (model) => anthropicSeedIds[model.id], (model) => model.tier],
    [OPENAI_PROVIDER_ID, OPENAI_MODELS, (model) => model.seedId, () => 'custom'],
    [GOOGLE_PROVIDER_ID, GEMINI_MODELS, (model) => model.seedId, () => 'custom'],
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO provider_models
    (id, provider_id, model_id, display_name, description, tier, enabled, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM provider_models WHERE provider_id = ?), ?)`);
  for (const [providerId, models, idFor, tierFor] of catalogs) {
    for (const model of models) {
      insert.run(idFor(model), providerId, model.id, model.name, model.description, tierFor(model), model.defaultEnabled === false ? 0 : 1, providerId, now);
    }
  }
}
