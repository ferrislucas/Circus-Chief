import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS } from '@circuschief/shared';
import { getTableSql, getColumns } from './migrationUtils.js';
import { BUILT_IN_OPENAI_COMMIT_ATTRIBUTION } from '../seedBaselineData.js';

function columnExists(db, table, column) {
  return getColumns(db, table).some((col) => col.name === column);
}

const ANTHROPIC_PROVIDER_ID = 'anthropic-default';
const OPENAI_PROVIDER_ID = 'openai-default';
const GOOGLE_PROVIDER_ID = 'google-default';
const FABLE_MODEL = {
  id: 'anthropic-fable',
  modelId: 'claude-fable-5',
  displayName: 'Fable 5',
  description: 'Next-generation intelligence',
};

/**
 * Insert (or, on re-run, no-op via `INSERT OR IGNORE`) one `provider_models`
 * row per entry in `models` for the given `providerId`. Shared by all three
 * built-in seed helpers below so each provider's catalog -- `CLAUDE_MODELS`,
 * `OPENAI_MODELS`, `GEMINI_MODELS` -- is the single source of truth for its
 * seeded rows (FRD-built-in-model-choices.md FR-1.2); there is no
 * hand-maintained duplicate list for any built-in provider.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} providerId
 * @param {Array} models - one of CLAUDE_MODELS / OPENAI_MODELS / GEMINI_MODELS
 */
function seedCatalogModels(db, providerId, models) {
  const hasTier = columnExists(db, 'provider_models', 'tier');
  const insertModel = hasTier
    ? db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, 'custom', ?)`
      )
    : db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

  const now = Date.now();
  for (const model of models) {
    if (hasTier) {
      insertModel.run(model.seedId, providerId, model.id, model.name, model.description, now);
    } else {
      insertModel.run(model.seedId, providerId, model.id, model.name, model.description, now);
    }
  }
}

/**
 * Single source of truth for the Anthropic built-in seed rows: derived from
 * `CLAUDE_MODELS` (shared/src/types.js), mirroring how
 * `seedBuiltInOpenAIProvider` derives from `OPENAI_MODELS` and
 * `seedBuiltInGoogleProvider` derives from `GEMINI_MODELS`. There is no
 * hand-maintained duplicate list here anymore -- adding a supported Claude
 * model is a one-line change to `CLAUDE_MODELS` (FRD-built-in-model-choices.md
 * FR-1.2).
 */
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

  seedCatalogModels(db, ANTHROPIC_PROVIDER_ID, CLAUDE_MODELS);
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

  seedCatalogModels(db, OPENAI_PROVIDER_ID, OPENAI_MODELS);
}

export function seedBuiltInGoogleProvider(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'google', 1, ?, ?)`
  ).run(GOOGLE_PROVIDER_ID, 'Google (Official)', now, now);

  seedCatalogModels(db, GOOGLE_PROVIDER_ID, GEMINI_MODELS);
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
  if (!columnExists(db, 'provider_models', 'tier')) {
    return;
  }
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

  const hasTier = columnExists(db, 'provider_models', 'tier');
  if (hasTier) {
    db.prepare(
      `INSERT OR IGNORE INTO provider_models (
         id, provider_id, model_id, display_name, description, tier, created_at
       )
       VALUES (?, ?, ?, ?, ?, 'fable', ?)`
    ).run(
      FABLE_MODEL.id,
      ANTHROPIC_PROVIDER_ID,
      FABLE_MODEL.modelId,
      FABLE_MODEL.displayName,
      FABLE_MODEL.description,
      Date.now()
    );

    db.prepare(
      `UPDATE provider_models
       SET model_id = ?, display_name = ?, description = ?
       WHERE provider_id = ? AND id = ?`
    ).run(
      FABLE_MODEL.modelId,
      FABLE_MODEL.displayName,
      FABLE_MODEL.description,
      ANTHROPIC_PROVIDER_ID,
      FABLE_MODEL.id
    );
  } else {
    db.prepare(
      `INSERT OR IGNORE INTO provider_models (
         id, provider_id, model_id, display_name, description, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      FABLE_MODEL.id,
      ANTHROPIC_PROVIDER_ID,
      FABLE_MODEL.modelId,
      FABLE_MODEL.displayName,
      FABLE_MODEL.description,
      Date.now()
    );

    db.prepare(
      `UPDATE provider_models
       SET model_id = ?, display_name = ?, description = ?
       WHERE provider_id = ? AND id = ?`
    ).run(
      FABLE_MODEL.modelId,
      FABLE_MODEL.displayName,
      FABLE_MODEL.description,
      ANTHROPIC_PROVIDER_ID,
      FABLE_MODEL.id
    );
  }
}

/**
 * The provider/catalog pairs shared by every catalog-driven migration helper
 * below (seeding, lifecycle sync, and the one-time older-lifecycle disable).
 */
const CATALOGS_BY_PROVIDER = [
  [ANTHROPIC_PROVIDER_ID, CLAUDE_MODELS],
  [OPENAI_PROVIDER_ID, OPENAI_MODELS],
  [GOOGLE_PROVIDER_ID, GEMINI_MODELS],
];

/** Seed current catalogs after enabled/sort_order columns have been added. */
export function syncBuiltInModelCatalogs(db) {
  const now = Date.now();
  const hasTier = columnExists(db, 'provider_models', 'tier');
  const insertModel = hasTier
    ? db.prepare(`INSERT OR IGNORE INTO provider_models
      (id, provider_id, model_id, display_name, description, tier, enabled, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, 'custom', ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM provider_models WHERE provider_id = ?), ?)`)
    : db.prepare(`INSERT OR IGNORE INTO provider_models
      (id, provider_id, model_id, display_name, description, enabled, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM provider_models WHERE provider_id = ?), ?)`);
  for (const [providerId, models] of CATALOGS_BY_PROVIDER) {
    for (const model of models) {
      insertModel.run(model.seedId, providerId, model.id, model.name, model.description, model.defaultEnabled === false ? 0 : 1, providerId, now);
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
 *
 * This also covers the Opus 4.8 -> Opus 5 lifecycle transition: because the
 * lifecycle/enabled/sort_order mechanism and the Opus 5 catalog addition
 * shipped together (never as separate releases), this single mechanism is
 * sufficient to disable Opus 4.8 on both fresh installs and databases
 * upgraded from origin/main -- see providerMigrationHelpers.test.js
 * ("provider-models-transition-opus-4-8-to-older-once redundancy (Slice C)")
 * for the regression proof. A previously-added, separately-marker-guarded
 * `transitionBuiltInOpus48ToOlderOnce` migration was removed as redundant
 * (PR #1063 remediation, Issue 3).
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
