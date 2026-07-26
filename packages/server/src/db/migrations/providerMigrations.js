import { addColumnIfMissing, tableExists, getTableSql } from './migrationUtils.js';
import {
  backfillBuiltInOpenAIAttribution,
  dedupeActiveProviderModelIdentities,
  disableOlderLifecycleModelsOnce,
  seedBuiltInFable5,
  seedBuiltInGoogleProvider,
  seedBuiltInOpenAIProvider,
  seedBuiltInProviders,
  syncBuiltInModelCatalogs,
  syncCatalogLifecycleMetadata,
  transitionBuiltInOpus48ToOlderOnce,
  updateBuiltInModels,
  updateBuiltInSonnet5,
  widenProviderModelsTierCheckForFable,
} from './providerMigrationHelpers.js';

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
          tier TEXT CHECK(tier IN ('fable', 'opus', 'sonnet', 'haiku', 'custom')),
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
      // Idempotency guard: this migration recreates the `providers` table via
      // `INSERT OR IGNORE INTO providers_new SELECT * FROM providers`, which is
      // sensitive to column count. Once any later migration adds a column (e.g.
      // `enabled`), re-running this `SELECT *` copy into the fixed 11-column
      // `providers_new` definition would fail with a column-count mismatch.
      // Since migrations run on every startup, skip the recreation when the
      // table's CHECK already permits 'google' (the only thing this migration
      // changes). Fresh DBs are created with the wide CHECK already, so this is
      // effectively a no-op there too.
      const existingSql = getTableSql(db, 'providers') || '';
      if (existingSql.includes("'google'")) {
        return;
      }

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
  {
    name: 'providers-backfill-built-in-openai-attribution',
    up(db) { backfillBuiltInOpenAIAttribution(db); },
  },
  {
    name: 'providers-update-built-in-opus-4-8',
    up(db) {
      const providerId = 'anthropic-default';

      db.prepare(
        `UPDATE provider_models
         SET description = ?
         WHERE provider_id = ? AND id = ?`
      ).run('Previous generation', providerId, 'anthropic-opus-4-7');

      db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('anthropic-opus-4-8', providerId, 'claude-opus-4-8', 'Opus 4.8', 'Most capable (default)', 'opus', Date.now());
    },
  },
  {
    name: 'providers-add-enabled',
    up(db) {
      addColumnIfMissing(db, 'providers', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    name: 'providers-update-built-in-sonnet-5',
    up(db) { updateBuiltInSonnet5(db); },
  },
  {
    name: 'provider-models-widen-tier-check-fable',
    up(db) { widenProviderModelsTierCheckForFable(db); },
  },
  {
    name: 'providers-seed-built-in-fable-5',
    up(db) { seedBuiltInFable5(db); },
  },
  {
    name: 'provider-models-add-enabled',
    up(db) { addColumnIfMissing(db, 'provider_models', 'enabled', 'INTEGER NOT NULL DEFAULT 1'); },
  },
  {
    name: 'provider-models-add-sort-order',
    up(db) { addColumnIfMissing(db, 'provider_models', 'sort_order', 'INTEGER'); },
  },
  {
    name: 'provider-models-backfill-sort-order',
    up(db) {
      // Tiebreak on `rowid` (true insertion order), not the lexical `id`
      // column: rows sharing an identical `created_at` (e.g. an entire
      // catalog seeded in one batch with one `Date.now()` call) must keep
      // their insertion order, which is catalog order for built-in
      // providers. Matches the tiebreak already used by
      // `dedupeActiveProviderModelIdentities`.
      db.exec(`UPDATE provider_models
        SET sort_order = (SELECT COUNT(*) FROM provider_models pm2
          WHERE pm2.provider_id = provider_models.provider_id
            AND (pm2.created_at < provider_models.created_at
              OR (pm2.created_at = provider_models.created_at AND pm2.rowid < provider_models.rowid)))
        WHERE sort_order IS NULL`);
    },
  },
  {
    name: 'provider-models-sync-built-in-catalogs',
    up(db) { syncBuiltInModelCatalogs(db); },
  },
  {
    name: 'provider-models-add-lifecycle',
    up(db) { addColumnIfMissing(db, 'provider_models', 'lifecycle', "TEXT NOT NULL DEFAULT 'current'"); },
  },
  {
    name: 'provider-models-add-catalog-managed',
    up(db) { addColumnIfMissing(db, 'provider_models', 'catalog_managed', 'INTEGER NOT NULL DEFAULT 0'); },
  },
  {
    name: 'provider-models-add-removed-at',
    up(db) { addColumnIfMissing(db, 'provider_models', 'removed_at', 'INTEGER'); },
  },
  {
    // Resolve any pre-existing duplicate (provider_id, model_id) pairs before
    // the unique partial index below is created (see FRD §0 "removing a
    // built-in choice must be durable"; Plan Phase 4 "resolving any legacy
    // duplicates deterministically").
    name: 'provider-models-dedupe-active-identity',
    up(db) { dedupeActiveProviderModelIdentities(db); },
  },
  {
    // A model id is unique per provider only among *active* rows -- a
    // soft-removed row and its later restored replacement intentionally
    // share (provider_id, model_id).
    name: 'provider-models-unique-active-identity-index',
    up(db) {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_models_active_identity
        ON provider_models(provider_id, model_id) WHERE removed_at IS NULL`);
    },
  },
  {
    // Keeps lifecycle/catalog_managed current every startup without ever
    // touching enabled/sort_order/removed_at (user-controlled state).
    name: 'provider-models-sync-catalog-lifecycle',
    up(db) { syncCatalogLifecycleMetadata(db); },
  },
  {
    // Supersedes the retired gpt-5.5-only special case: every catalog entry
    // classified `lifecycle: 'older'` (across Anthropic, OpenAI, and Google)
    // is disabled exactly once, guarded by an app_settings marker so a
    // user's later re-enable decision is never overwritten.
    name: 'provider-models-disable-older-lifecycle-once',
    up(db) { disableOlderLifecycleModelsOnce(db); },
  },
  {
    // Release transition: Opus 5 becomes the current Anthropic default,
    // superseding Opus 4.8. Databases that already ran the general
    // older-lifecycle-once migration above (before Opus 4.8 was reclassified
    // `lifecycle: 'older'`) never disabled Opus 4.8 through that mechanism,
    // so this narrowly-scoped, separately-marker-guarded transition disables
    // it exactly once. See providerMigrationHelpers.js for full rationale.
    name: 'provider-models-transition-opus-4-8-to-older-once',
    up(db) { transitionBuiltInOpus48ToOlderOnce(db); },
  },
];
