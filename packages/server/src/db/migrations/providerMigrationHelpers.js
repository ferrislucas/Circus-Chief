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

/**
 * The provider/catalog pairs shared by every catalog-driven migration helper
 * below (seeding, lifecycle sync, and the one-time older-lifecycle disable).
 */
const CATALOGS_BY_PROVIDER = [
  [ANTHROPIC_PROVIDER_ID, CLAUDE_MODELS, (model) => model.tier],
  [OPENAI_PROVIDER_ID, OPENAI_MODELS, () => 'custom'],
  [GOOGLE_PROVIDER_ID, GEMINI_MODELS, () => 'custom'],
];

/** Seed current catalogs after enabled/sort_order columns have been added. */
export function syncBuiltInModelCatalogs(db) {
  const now = Date.now();
  const insert = db.prepare(`INSERT OR IGNORE INTO provider_models
    (id, provider_id, model_id, display_name, description, tier, enabled, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM provider_models WHERE provider_id = ?), ?)`);
  for (const [providerId, models, tierFor] of CATALOGS_BY_PROVIDER) {
    for (const model of models) {
      insert.run(model.seedId, providerId, model.id, model.name, model.description, tierFor(model), model.defaultEnabled === false ? 0 : 1, providerId, now);
    }
  }
}

/**
 * Keep `lifecycle` and `catalog_managed` in sync with the current catalog on
 * every startup. Never touches `enabled`, `sort_order`, or `removed_at` --
 * those are user-controlled once seeded (FRD §0 "Startup must never overwrite
 * a user's later enable/disable decision").
 */
export function syncCatalogLifecycleMetadata(db) {
  const updateLifecycle = db.prepare(
    `UPDATE provider_models SET lifecycle = ?, catalog_managed = 1
     WHERE provider_id = ? AND model_id = ? AND removed_at IS NULL AND lifecycle IS NOT ?`
  );
  for (const [providerId, models] of CATALOGS_BY_PROVIDER) {
    for (const model of models) {
      const lifecycle = model.lifecycle || 'current';
      updateLifecycle.run(lifecycle, providerId, model.id, lifecycle);
    }
  }
}

const OLDER_LIFECYCLE_MIGRATION_MARKER = 'provider_models_disable_older_lifecycle_v1';

/**
 * One-time, marker-guarded migration: disable every catalog entry classified
 * as `lifecycle: 'older'` across all three built-in providers. Guarded by a
 * row in `app_settings` (rather than the `sort_order IS NULL` trick used by
 * the retired gpt-5.5-only migration) so it runs exactly once regardless of
 * when each row was originally seeded, and never re-disables a model a user
 * has since re-enabled.
 */
export function disableOlderLifecycleModelsOnce(db) {
  const already = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(OLDER_LIFECYCLE_MIGRATION_MARKER);
  if (already) return;

  const disable = db.prepare(
    `UPDATE provider_models SET enabled = 0 WHERE provider_id = ? AND model_id = ? AND removed_at IS NULL`
  );
  const transaction = db.transaction(() => {
    for (const [providerId, models] of CATALOGS_BY_PROVIDER) {
      for (const model of models) {
        if ((model.lifecycle || 'current') === 'older') {
          disable.run(providerId, model.id);
        }
      }
    }
    db.prepare(
      'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(OLDER_LIFECYCLE_MIGRATION_MARKER, 'done', Date.now());
  });
  transaction();
}

const OPUS_4_8_LIFECYCLE_TRANSITION_MARKER = 'provider_models_opus_4_8_lifecycle_transition_v1';

/**
 * One-time, marker-guarded release transition: Opus 5 supersedes Opus 4.8 as
 * the current Anthropic default (see the "Add Opus 5" plan, Slice 2).
 *
 * `syncBuiltInModelCatalogs` / `syncCatalogLifecycleMetadata` already handle
 * seeding the new Opus 5 row and updating Opus 4.8's `lifecycle` column to
 * `'older'` generically, on every startup, for both fresh and upgraded
 * databases. But `disableOlderLifecycleModelsOnce` (the general older-model
 * disable mechanism) is guarded by a marker that already ran -- on databases
 * upgraded from before this release, that marker fired when Opus 4.8 was
 * still `lifecycle: 'current'`, so it never disabled it and never will again.
 *
 * This migration is a narrowly-scoped, separately-marker-guarded transition
 * that disables the built-in, catalog-managed, non-removed Opus 4.8 row
 * exactly once. It intentionally:
 *   - only touches the built-in Anthropic Opus 4.8 row (never unrelated
 *     models, never a user-added/custom row that happens to share the id),
 *   - skips soft-removed rows (removed_at IS NOT NULL) so a user's removal
 *     is never "undone" by resurrecting an enabled state,
 *   - never re-runs once its marker exists, so a user who re-enables or
 *     reorders Opus 4.8 afterward is never overwritten by a later startup.
 *
 * On a fresh install this is a no-op in effect: `disableOlderLifecycleModelsOnce`
 * already disables Opus 4.8 (correctly classified `'older'` from the start),
 * so this migration's UPDATE simply matches zero additional rows beyond what
 * is already disabled.
 */
export function transitionBuiltInOpus48ToOlderOnce(db) {
  const already = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(OPUS_4_8_LIFECYCLE_TRANSITION_MARKER);
  if (already) return;

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE provider_models
       SET enabled = 0
       WHERE provider_id = ? AND model_id = ? AND catalog_managed = 1 AND removed_at IS NULL`
    ).run(ANTHROPIC_PROVIDER_ID, 'claude-opus-4-8');

    db.prepare(
      'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(OPUS_4_8_LIFECYCLE_TRANSITION_MARKER, 'done', Date.now());
  });
  transaction();
}

/**
 * Resolve any pre-existing duplicate (provider_id, model_id) pairs among
 * *active* (non-removed) rows before the unique partial index is created.
 * Keeps the earliest row (by created_at, then rowid as an insertion-order
 * tiebreak) and soft-removes the rest so historical continuity is preserved
 * rather than destroyed.
 */
export function dedupeActiveProviderModelIdentities(db) {
  const duplicates = db.prepare(`
    SELECT id FROM provider_models pm
    WHERE removed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM provider_models earlier
        WHERE earlier.provider_id = pm.provider_id
          AND earlier.model_id = pm.model_id
          AND earlier.removed_at IS NULL
          AND (earlier.created_at < pm.created_at
            OR (earlier.created_at = pm.created_at AND earlier.rowid < pm.rowid))
      )
  `).all();

  if (duplicates.length === 0) return;

  const softRemove = db.prepare('UPDATE provider_models SET removed_at = ? WHERE id = ?');
  const now = Date.now();
  const transaction = db.transaction(() => {
    for (const { id } of duplicates) {
      softRemove.run(now, id);
    }
  });
  transaction();
}
