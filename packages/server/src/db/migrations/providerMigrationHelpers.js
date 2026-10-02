/* eslint-disable max-lines -- migration helpers share provider constants and preserve ordered upgrade operations. */
import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS, MUSE_MODELS } from '@circuschief/shared';
import { getTableSql } from './migrationUtils.js';
import { BUILT_IN_OPENAI_COMMIT_ATTRIBUTION } from '../seedBaselineData.js';

const ANTHROPIC_PROVIDER_ID = 'anthropic-default';
const OPENAI_PROVIDER_ID = 'openai-default';
const GOOGLE_PROVIDER_ID = 'google-default';
const META_PROVIDER_ID = 'meta-default';
const FABLE_MODEL = {
  id: 'anthropic-fable',
  modelId: 'claude-fable-5',
  displayName: 'Fable 5',
  description: 'Next-generation intelligence',
  tier: 'fable',
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
 * @param {(model: object) => string} tierFor - resolves the `tier` column
 *   value for a catalog entry (Anthropic rows carry a real tier; OpenAI/Google
 *   built-in rows use the fixed 'custom' tier).
 */
function seedCatalogModels(db, providerId, models, tierFor) {
  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const now = Date.now();
  for (const model of models) {
    insertModel.run(model.seedId, providerId, model.id, model.name, model.description, tierFor(model), now);
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

  seedCatalogModels(db, ANTHROPIC_PROVIDER_ID, CLAUDE_MODELS, (model) => model.tier);
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

  seedCatalogModels(db, OPENAI_PROVIDER_ID, OPENAI_MODELS, () => 'custom');
}

export function seedBuiltInGoogleProvider(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'google', 1, ?, ?)`
  ).run(GOOGLE_PROVIDER_ID, 'Google (Official)', now, now);

  seedCatalogModels(db, GOOGLE_PROVIDER_ID, GEMINI_MODELS, () => 'custom');
}

/**
 * Seed (and backfill) the built-in Meta provider and its Muse model rows.
 *
 * Mirrors {@link seedBuiltInGoogleProvider}: `INSERT OR IGNORE` over the
 * current `MUSE_MODELS` catalog, so re-runs on every startup pick up newly
 * added built-in Muse models without a dedicated migration.
 */
export function seedBuiltInMetaProvider(db) {
  const now = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO providers (
       id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at
     )
     VALUES (?, ?, NULL, NULL, 'meta', 1, ?, ?)`
  ).run(META_PROVIDER_ID, 'Meta (Official)', now, now);

  seedCatalogModels(db, META_PROVIDER_ID, MUSE_MODELS, () => 'custom');
}

export function seedBuiltInProviders(db) {
  seedBuiltInAnthropicProvider(db);
  seedBuiltInOpenAIProvider(db);
}

/**
 * Widen the `providers.kind` CHECK constraint to the given kinds by
 * recreating the table — SQLite CHECKs are baked into the table definition
 * and cannot be altered in place.
 *
 * Unlike the one-shot 'providers-widen-kind-check-google' swap, this is
 * SHAPE-AWARE: it rebuilds `providers_new` from the live
 * `PRAGMA table_info(providers)` (preserving every existing column
 * verbatim — including later additions like `enabled`) instead of a
 * hardcoded column list. A hardcoded list breaks on any database whose
 * column count differs (e.g. an existing install that already ran
 * 'providers-add-enabled' yields 12 values into an 11-column copy and the
 * boot crashes). Explicit column lists are used for the copy so column
 * ORDER differences are harmless too.
 *
 * Also drops a stale `providers_new` left behind by a previously crashed
 * swap attempt before rebuilding it.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} kinds - Allowed kind values, e.g. ['anthropic','openai','google','meta']
 */
/**
 * Re-emit a `PRAGMA table_info` default verbatim when it is a plain
 * literal, or parenthesized when it is an expression. PRAGMA strips the
 * outer parens SQLite requires around expression defaults (e.g. it reports
 * `unixepoch() * 1000` for `DEFAULT (unixepoch() * 1000)`), so re-emitting
 * the raw text is a syntax error — caught live when this swap ran against
 * a fresh-schema database.
 */
function formatColumnDefault(dfltValue) {
  if (dfltValue === null || dfltValue === undefined) return '';
  if (/^\(.*\)$/s.test(dfltValue)) return ` DEFAULT ${dfltValue}`;
  if (/^'.*'$/s.test(dfltValue)) return ` DEFAULT ${dfltValue}`;
  if (/^(NULL|TRUE|FALSE|CURRENT_TIME|CURRENT_DATE|CURRENT_TIMESTAMP)$/i.test(dfltValue)) {
    return ` DEFAULT ${dfltValue}`;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(dfltValue)) return ` DEFAULT ${dfltValue}`;
  return ` DEFAULT (${dfltValue})`;
}

/**
 * Self-guard: the table swap below only preserves plain columns (type, PK,
 * NOT NULL, defaults) plus the widened kind CHECK. Anything fancier on a
 * future `providers` shape — UNIQUE constraints/indexes, triggers — would
 * be silently dropped, so fail loudly instead. Asserts column/UNIQUE/
 * trigger counts before and after the swap.
 */
function assertProvidersSwapSafe(db, columns) {
  const indexRows = db.prepare('PRAGMA index_list(providers)').all();
  const kept = indexRows.filter((index) => index.origin === 'pk');
  const dropped = indexRows.filter((index) => index.origin !== 'pk');
  if (dropped.length > 0) {
    throw new Error(
      `widenProvidersKindCheck would silently drop indexes on providers: ${dropped.map((i) => i.name).join(', ')}. ` +
      'Teach the swap to preserve them instead of widening the kind CHECK.',
    );
  }
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'providers'").all();
  if (triggers.length > 0) {
    throw new Error(
      `widenProvidersKindCheck would silently drop triggers on providers: ${triggers.map((t) => t.name).join(', ')}. ` +
      'Teach the swap to preserve them instead of widening the kind CHECK.',
    );
  }
  return { columnNames: columns.map((c) => c.name), indexNames: kept.map((i) => i.name) };
}

export function widenProvidersKindCheck(db, kinds) {
  const columns = db.prepare('PRAGMA table_info(providers)').all();
  if (columns.length === 0) return;
  const preSwap = assertProvidersSwapSafe(db, columns);

  const kindList = kinds.map((kind) => `'${kind}'`).join(',');
  const definitions = columns.map((column) => {
    if (column.name === 'kind') {
      return `"kind" ${column.type} NOT NULL DEFAULT 'anthropic' CHECK(kind IN (${kindList}))`;
    }
    let definition = `"${column.name}" ${column.type}`;
    if (column.pk) {
      definition += ' PRIMARY KEY';
    } else if (column.notnull) {
      definition += ' NOT NULL';
    }
    definition += formatColumnDefault(column.dflt_value);
    return definition;
  });
  const columnNames = columns.map((column) => `"${column.name}"`).join(', ');

  // IMPORTANT: Disable foreign key enforcement during the table swap.
  // provider_models has ON DELETE CASCADE referencing providers; SQLite
  // fires that cascade when DROP TABLE deletes parent rows, which would
  // wipe all provider_models data. Disabling FK enforcement prevents the
  // cascade. It is re-enabled immediately after the rename.
  //
  // The FK pragma is toggled OUTSIDE the transaction below: SQLite ignores
  // `PRAGMA foreign_keys` changes made inside a transaction.
  db.pragma('foreign_keys = OFF');
  try {
    // Atomic swap (finding #4): every statement between BEGIN IMMEDIATE and
    // COMMIT applies together or not at all, so a crash or error mid-swap
    // can no longer leave a half-renamed providers table behind.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        DROP TABLE IF EXISTS providers_new;

        CREATE TABLE providers_new (
          ${definitions.join(',\n        ')}
        );

        INSERT INTO providers_new (${columnNames}) SELECT ${columnNames} FROM providers;

        DROP TABLE providers;

        ALTER TABLE providers_new RENAME TO providers;

        CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
      `);

      // Post-swap assertion (defense in depth): column and PK-index counts
      // must match the pre-swap fingerprint. These reads run inside the
      // transaction, so a mismatch rolls the whole swap back instead of
      // leaving it applied.
      const postColumns = db.prepare('PRAGMA table_info(providers)').all().map((c) => c.name);
      const postIndexes = db.prepare('PRAGMA index_list(providers)').all()
        .filter((index) => index.origin === 'pk')
        .map((i) => i.name);
      if (postColumns.join(',') !== preSwap.columnNames.join(',')) {
        throw new Error(
          `widenProvidersKindCheck changed the providers columns (before: ${preSwap.columnNames.join(',')}; after: ${postColumns.join(',')}).`,
        );
      }
      if (postIndexes.join(',') !== preSwap.indexNames.join(',')) {
        throw new Error('widenProvidersKindCheck changed the providers indexes; refusing to continue silently.');
      }

      db.exec('COMMIT');
    } catch (swapError) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already rolled back or never began: the original error wins */
      }
      throw swapError;
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
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
  [META_PROVIDER_ID, MUSE_MODELS, () => 'custom'],
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
