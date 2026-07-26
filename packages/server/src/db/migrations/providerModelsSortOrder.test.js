import { describe, it, expect } from 'vitest';
import { CLAUDE_MODELS, OPENAI_MODELS, GEMINI_MODELS } from '@circuschief/shared';
import { DatabaseManager } from '../DatabaseManager.js';
import { getModels } from '../providerModelOperations.js';
import { providerMigrations } from './providerMigrations.js';

function withDb(fn) {
  const manager = new DatabaseManager();
  const db = manager.init(':memory:');
  try {
    return fn(db, manager);
  } finally {
    manager.close();
  }
}

const backfillSortOrderMigration = providerMigrations.find(
  (m) => m.name === 'provider-models-backfill-sort-order'
);

describe('fresh-install built-in model catalog order', () => {
  it('orders anthropic-default models to match CLAUDE_MODELS catalog order', () => {
    withDb((db) => {
      const models = getModels(db, 'anthropic-default');
      expect(models.map((m) => m.modelId)).toEqual(CLAUDE_MODELS.map((m) => m.id));
    });
  });

  it('seeds exactly one active, current, enabled Opus 5 row and an older, disabled Opus 4.8 row', () => {
    withDb((db) => {
      const models = getModels(db, 'anthropic-default');
      expect(models.filter((m) => m.modelId === 'claude-opus-5')).toHaveLength(1);
      expect(models.find((m) => m.modelId === 'claude-opus-5')).toMatchObject({
        lifecycle: 'current',
        enabled: true,
      });
      expect(models.find((m) => m.modelId === 'claude-opus-4-8')).toMatchObject({
        lifecycle: 'older',
        enabled: false,
      });
    });
  });

  it('orders openai-default models to match OPENAI_MODELS catalog order (default-first)', () => {
    withDb((db) => {
      const models = getModels(db, 'openai-default');
      expect(models.map((m) => m.modelId)).toEqual(OPENAI_MODELS.map((m) => m.id));
      // The default model ('gpt-5.6-sol') must sort first, not alphabetically last.
      expect(models[0].modelId).toBe('gpt-5.6-sol');
    });
  });

  it('orders google-default models to match GEMINI_MODELS catalog order (default-first)', () => {
    withDb((db) => {
      const models = getModels(db, 'google-default');
      expect(models.map((m) => m.modelId)).toEqual(GEMINI_MODELS.map((m) => m.id));
      expect(models[0].modelId).toBe('gemini-2.5-pro');
    });
  });
});

describe('provider-models-backfill-sort-order migration', () => {
  it('exists and is registered', () => {
    expect(backfillSortOrderMigration).toBeDefined();
    expect(typeof backfillSortOrderMigration.up).toBe('function');
  });

  it('tiebreaks rows sharing one created_at by insertion order (rowid), not lexical row id', () => {
    withDb((db) => {
      // Fixture: three rows for a single custom provider, all sharing the same
      // created_at, inserted in a deliberate order whose row ids are NOT in
      // ascending lexical order relative to insertion order (a "zzz"-prefixed
      // id is inserted first, and an "aaa"-prefixed id is inserted last).
      const now = Date.now();
      db.prepare(
        `INSERT INTO providers (id, name, kind, is_built_in, created_at, updated_at)
         VALUES (?, ?, 'anthropic', 0, ?, ?)`
      ).run('fixture-provider', 'Fixture Provider', now, now);

      const insert = db.prepare(
        `INSERT INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, 'custom', ?)`
      );
      insert.run('zzz-first-inserted', 'fixture-provider', 'model-a', 'Model A', null, now);
      insert.run('mmm-second-inserted', 'fixture-provider', 'model-b', 'Model B', null, now);
      insert.run('aaa-third-inserted', 'fixture-provider', 'model-c', 'Model C', null, now);

      // Reset sort_order to NULL so the migration's backfill logic runs on these rows.
      db.prepare('UPDATE provider_models SET sort_order = NULL WHERE provider_id = ?').run('fixture-provider');

      backfillSortOrderMigration.up(db);

      const rows = db
        .prepare('SELECT id FROM provider_models WHERE provider_id = ? ORDER BY sort_order ASC')
        .all('fixture-provider');

      // Correct: preserves insertion order (zzz, mmm, aaa), not lexical id order (aaa, mmm, zzz).
      expect(rows.map((r) => r.id)).toEqual(['zzz-first-inserted', 'mmm-second-inserted', 'aaa-third-inserted']);
    });
  });
});

// `provider-models-transition-opus-4-8-to-older-once` (and its dedicated
// tests) were removed in the PR #1063 remediation, Slice C: it was a
// narrowly-scoped, marker-guarded migration meant to protect an intermediate
// release where the general `disableOlderLifecycleModelsOnce` marker had
// already fired before Opus 4.8 was reclassified `lifecycle: 'older'`. That
// intermediate release never shipped -- the entire lifecycle/enabled/
// sort_order/soft-removal mechanism and the Opus 4.8 reclassification landed
// together, unreleased, in this same branch. See
// `providerMigrationHelpers.test.js` ("provider-models-transition-opus-4-8-to-older-once
// redundancy (Slice C)") for the regression tests proving Opus 4.8 ends up
// disabled by `disableOlderLifecycleModelsOnce` alone on both a fresh install
// and a database upgraded from origin/main -- with no dedicated transition
// migration needed.
