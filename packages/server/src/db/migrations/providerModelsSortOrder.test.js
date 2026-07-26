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

const opus48TransitionMigration = providerMigrations.find(
  (m) => m.name === 'provider-models-transition-opus-4-8-to-older-once'
);

const OPUS_4_8_TRANSITION_MARKER = 'provider_models_opus_4_8_lifecycle_transition_v1';

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

describe('provider-models-transition-opus-4-8-to-older-once migration', () => {
  it('exists and is registered', () => {
    expect(opus48TransitionMigration).toBeDefined();
    expect(typeof opus48TransitionMigration.up).toBe('function');
  });

  it('upgraded database (general older-lifecycle marker already ran before Opus 4.8 was reclassified): disables active catalog-managed Opus 4.8 exactly once', () => {
    withDb((db) => {
      // Simulate the pre-Opus-5 upgraded-database state: this release's
      // transition marker hasn't run yet, and Opus 4.8 is still enabled (as
      // it would be on a database where the general older-lifecycle-once
      // migration fired back when Opus 4.8 was still `lifecycle: 'current'`).
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(OPUS_4_8_TRANSITION_MARKER);
      db.prepare('UPDATE provider_models SET enabled = 1 WHERE provider_id = ? AND model_id = ?')
        .run('anthropic-default', 'claude-opus-4-8');

      opus48TransitionMigration.up(db);

      const opus48 = getModels(db, 'anthropic-default').find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus48.enabled).toBe(false);

      const marker = db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(OPUS_4_8_TRANSITION_MARKER);
      expect(marker).toBeTruthy();
    });
  });

  it('is idempotent: repeated startup does not error and does not change state further', () => {
    withDb((db) => {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(OPUS_4_8_TRANSITION_MARKER);
      db.prepare('UPDATE provider_models SET enabled = 1 WHERE provider_id = ? AND model_id = ?')
        .run('anthropic-default', 'claude-opus-4-8');

      opus48TransitionMigration.up(db);
      opus48TransitionMigration.up(db);
      opus48TransitionMigration.up(db);

      const opus48 = getModels(db, 'anthropic-default').find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus48.enabled).toBe(false);
    });
  });

  it('after the transition marker exists, a user re-enabling Opus 4.8 is not overwritten by a later startup', () => {
    withDb((db) => {
      // withDb() runs the full migration chain, including this transition,
      // so the marker already exists by this point.
      db.prepare('UPDATE provider_models SET enabled = 1 WHERE provider_id = ? AND model_id = ?')
        .run('anthropic-default', 'claude-opus-4-8');

      opus48TransitionMigration.up(db);

      const opus48 = getModels(db, 'anthropic-default').find((m) => m.modelId === 'claude-opus-4-8');
      expect(opus48.enabled).toBe(true);
    });
  });

  it('does not restore a soft-removed Opus 4.8 row', () => {
    withDb((db) => {
      const opus48Row = db
        .prepare('SELECT id FROM provider_models WHERE provider_id = ? AND model_id = ?')
        .get('anthropic-default', 'claude-opus-4-8');
      db.prepare('UPDATE provider_models SET removed_at = ?, enabled = 1 WHERE id = ?').run(Date.now(), opus48Row.id);
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(OPUS_4_8_TRANSITION_MARKER);

      opus48TransitionMigration.up(db);

      const row = db.prepare('SELECT enabled, removed_at FROM provider_models WHERE id = ?').get(opus48Row.id);
      expect(row.removed_at).not.toBeNull();
      expect(row.enabled).toBe(1);
    });
  });

  it('leaves unrelated model enablement, ordering, and other built-in providers unchanged', () => {
    withDb((db) => {
      const openaiBefore = getModels(db, 'openai-default');
      const googleBefore = getModels(db, 'google-default');
      const anthropicOthersBefore = getModels(db, 'anthropic-default').filter((m) => m.modelId !== 'claude-opus-4-8');

      db.prepare('DELETE FROM app_settings WHERE key = ?').run(OPUS_4_8_TRANSITION_MARKER);
      opus48TransitionMigration.up(db);

      expect(getModels(db, 'openai-default')).toEqual(openaiBefore);
      expect(getModels(db, 'google-default')).toEqual(googleBefore);
      expect(getModels(db, 'anthropic-default').filter((m) => m.modelId !== 'claude-opus-4-8')).toEqual(anthropicOthersBefore);
    });
  });
});
