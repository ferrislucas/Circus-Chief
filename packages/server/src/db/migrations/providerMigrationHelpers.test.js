import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { CLAUDE_MODELS } from '@circuschief/shared';
import { seedBuiltInAnthropicProvider } from './providerMigrationHelpers.js';
import { allMigrations } from './index.js';
import { seedBaselineData } from '../seedBaselineData.js';
import { getModels } from '../providerModelOperations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal schema matching the 'providers-create-tables' migration, enough to
 * exercise seedBuiltInAnthropicProvider() in isolation from the rest of the
 * migration chain (which would otherwise mask gaps in the seed helper itself
 * via the later catalog-sync migration).
 */
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
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

    CREATE TABLE provider_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      tier TEXT CHECK(tier IN ('fable', 'opus', 'sonnet', 'haiku', 'custom')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);
  return db;
}

describe('seedBuiltInAnthropicProvider (single source of truth: CLAUDE_MODELS)', () => {
  it('seeds exactly the model ids in CLAUDE_MODELS -- including claude-opus-5 -- on a fresh DB', () => {
    const db = freshDb();
    try {
      seedBuiltInAnthropicProvider(db);

      const rows = db
        .prepare('SELECT model_id FROM provider_models WHERE provider_id = ?')
        .all('anthropic-default');

      expect(rows.map((r) => r.model_id).sort()).toEqual(
        CLAUDE_MODELS.map((m) => m.id).sort()
      );
    } finally {
      db.close();
    }
  });

  it('derives display name and description from CLAUDE_MODELS for every seeded row', () => {
    const db = freshDb();
    try {
      seedBuiltInAnthropicProvider(db);

      const rows = db
        .prepare('SELECT model_id, display_name, description FROM provider_models WHERE provider_id = ?')
        .all('anthropic-default');
      const byModelId = new Map(rows.map((r) => [r.model_id, r]));

      for (const model of CLAUDE_MODELS) {
        const row = byModelId.get(model.id);
        expect(row).toBeDefined();
        expect(row.display_name).toBe(model.name);
        expect(row.description).toBe(model.description);
      }
    } finally {
      db.close();
    }
  });

  it('is idempotent: running it twice does not duplicate or error', () => {
    const db = freshDb();
    try {
      seedBuiltInAnthropicProvider(db);
      seedBuiltInAnthropicProvider(db);

      const rows = db
        .prepare('SELECT model_id FROM provider_models WHERE provider_id = ?')
        .all('anthropic-default');

      expect(rows.map((r) => r.model_id).sort()).toEqual(
        CLAUDE_MODELS.map((m) => m.id).sort()
      );
    } finally {
      db.close();
    }
  });
});

/**
 * Slice C (PR #1063 remediation, Issue 3): this proved that a dedicated
 * `transitionBuiltInOpus48ToOlderOnce` migration did no necessary work on any
 * database state actually reachable in this repository's history, and was
 * fully redundant with the general `disableOlderLifecycleModelsOnce`
 * mechanism -- so it was deleted (see providerMigrationHelpers.js and
 * providerMigrations.js history). It was meant to protect an intermediate
 * release where the general older-lifecycle-once marker had already fired
 * before Opus 4.8 was reclassified `lifecycle: 'older'`; that intermediate
 * release never shipped -- the entire lifecycle/enabled/sort_order/
 * soft-removal mechanism and the Opus 4.8 reclassification landed together,
 * unreleased, in this same branch.
 *
 * These are now permanent regression tests: they run the full migration
 * chain (`allMigrations`, which no longer contains any dedicated transition
 * migration) against two fixtures --
 *   (a) a fresh install (current schema.sql + current seedBaselineData), and
 *   (b) a database "upgraded from origin/main" -- reconstructed from the
 *       schema and seeding logic actually present on origin/main at commit
 *       e2b6a378 (captured in __fixtures__/pre-lifecycle-schema-origin-main-e2b6a378.sql),
 *       which predates this branch's entire lifecycle/enabled/sort_order/
 *       soft-removal mechanism --
 * and assert both converge to Opus 4.8 disabled via `disableOlderLifecycleModelsOnce`
 * alone, guarding against a future regression reintroducing the need for a
 * dedicated transition migration without one being added back.
 */
describe('Opus 4.8 lifecycle disable (Slice C: no dedicated transition migration needed)', () => {
  const REMOVED_MIGRATION_NAME = 'provider-models-transition-opus-4-8-to-older-once';

  it('the dedicated transition migration was removed and is not registered', () => {
    expect(allMigrations.some((m) => m.name === REMOVED_MIGRATION_NAME)).toBe(false);
  });

  it('fresh install: Opus 4.8 ends up disabled by disableOlderLifecycleModelsOnce alone', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const schema = readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8');
      db.exec(schema);
      seedBaselineData(db);
      for (const migration of allMigrations) {
        migration.up(db);
      }

      const opus48 = getModels(db, 'anthropic-default').find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus48).toBeDefined();
      expect(opus48.enabled).toBe(false);
    } finally {
      db.close();
    }
  });

  it('upgraded from origin/main (pre-lifecycle schema + seeding): Opus 4.8 ends up disabled by disableOlderLifecycleModelsOnce alone', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const legacySchema = readFileSync(
        join(__dirname, '__fixtures__', 'pre-lifecycle-schema-origin-main-e2b6a378.sql'),
        'utf-8'
      );
      db.exec(legacySchema);

      // Mirrors origin/main's seedBaselineData.js seedBuiltInProviders() as of
      // commit e2b6a378 (hand-maintained anthropic list, pre-CLAUDE_MODELS
      // derivation; Opus 4.8 is the current/enabled default there).
      const now = Date.now();
      db.prepare(
        `INSERT OR IGNORE INTO providers (id, name, base_url, auth_token, kind, is_built_in, created_at, updated_at)
         VALUES ('anthropic-default', 'Anthropic (Official)', NULL, NULL, 'anthropic', 1, ?, ?)`
      ).run(now, now);
      const legacyAnthropicModels = [
        { id: 'anthropic-fable', modelId: 'claude-fable-5', displayName: 'Fable 5', tier: 'fable' },
        { id: 'anthropic-haiku', modelId: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', tier: 'haiku' },
        { id: 'anthropic-sonnet', modelId: 'claude-sonnet-5', displayName: 'Sonnet 5', tier: 'sonnet' },
        { id: 'anthropic-opus', modelId: 'claude-opus-4-6', displayName: 'Opus 4.6', tier: 'opus' },
        { id: 'anthropic-opus-4-7', modelId: 'claude-opus-4-7', displayName: 'Opus 4.7', tier: 'opus' },
        { id: 'anthropic-opus-4-8', modelId: 'claude-opus-4-8', displayName: 'Opus 4.8', tier: 'opus' },
      ];
      const insertModel = db.prepare(
        `INSERT OR IGNORE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, 'anthropic-default', ?, ?, NULL, ?, ?)`
      );
      for (const model of legacyAnthropicModels) {
        insertModel.run(model.id, model.modelId, model.displayName, model.tier, now);
      }
      // Note: this legacy schema predates the `enabled` column entirely (it's
      // added by the `provider-models-add-enabled` migration below, defaulting
      // every existing row -- including Opus 4.8 -- to enabled=1), which is
      // exactly the pre-lifecycle state this fixture is meant to represent.

      for (const migration of allMigrations) {
        migration.up(db);
      }

      const opus48 = getModels(db, 'anthropic-default').find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus48).toBeDefined();
      expect(opus48.enabled).toBe(false);
    } finally {
      db.close();
    }
  });
});
