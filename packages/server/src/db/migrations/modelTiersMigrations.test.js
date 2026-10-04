import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { modelTiersMigrations } from './modelTiersMigrations.js';

const repairMembers = modelTiersMigrations.find(
  (migration) => migration.name === 'model-tiers-repair-members-and-unique-indexes'
);
const reserveTierReferencePrefix = modelTiersMigrations.find(
  (migration) => migration.name === 'provider-models-reserve-tier-reference-prefix'
);

function createLegacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_tier_members (
      id TEXT PRIMARY KEY,
      tier_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('model tier member repair migration', () => {
  it('canonically repairs malformed legacy positions without colliding with an existing position constraint', () => {
    const db = createLegacyDatabase();
    try {
      // Simulates a database which acquired this constraint before a later run
      // encounters malformed branch-era data.
      db.exec('CREATE UNIQUE INDEX legacy_tier_position ON model_tier_members(tier_id, position)');
      const insert = db.prepare(`INSERT INTO model_tier_members
        (id, tier_id, provider_id, model_id, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
      insert.run('a-first', 'tier-a', 'provider-a', 'model-a', -1, 10);
      insert.run('a-gap', 'tier-a', 'provider-a', 'model-b', 5, 30);
      insert.run('b-first', 'tier-b', 'provider-b', 'model-a', -3, 10);
      insert.run('b-gap', 'tier-b', 'provider-b', 'model-b', 9, 20);

      repairMembers.up(db);

      expect(db.prepare(`SELECT id, tier_id, position FROM model_tier_members
        ORDER BY tier_id, position`).all()).toEqual([
        { id: 'a-first', tier_id: 'tier-a', position: 0 },
        { id: 'a-gap', tier_id: 'tier-a', position: 1 },
        { id: 'b-first', tier_id: 'tier-b', position: 0 },
        { id: 'b-gap', tier_id: 'tier-b', position: 1 },
      ]);
      expect(() => db.prepare(`INSERT INTO model_tier_members
        (id, tier_id, provider_id, model_id, position, created_at)
        VALUES ('duplicate-pair', 'tier-a', 'provider-a', 'model-a', 2, 40)`).run()).toThrow();
      expect(() => db.prepare(`INSERT INTO model_tier_members
        (id, tier_id, provider_id, model_id, position, created_at)
        VALUES ('duplicate-position', 'tier-a', 'provider-z', 'model-z', 0, 40)`).run()).toThrow();
    } finally {
      db.close();
    }
  });

  it('uses legacy position, creation time, then id as its deterministic ordering and rolls back on failure', () => {
    const db = createLegacyDatabase();
    try {
      const insert = db.prepare(`INSERT INTO model_tier_members
        (id, tier_id, provider_id, model_id, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`);
      insert.run('same-position-b', 'tier-a', 'provider-a', 'model-b', 1, 20);
      insert.run('same-position-a', 'tier-a', 'provider-a', 'model-a', 1, 20);
      insert.run('earlier-position', 'tier-a', 'provider-a', 'model-c', -1, 99);
      insert.run('duplicate-pair', 'tier-a', 'provider-a', 'model-a', 8, 30);

      repairMembers.up(db);
      expect(db.prepare('SELECT id, position FROM model_tier_members ORDER BY position').all()).toEqual([
        { id: 'earlier-position', position: 0 },
        { id: 'same-position-a', position: 1 },
        { id: 'same-position-b', position: 2 },
      ]);
    } finally {
      db.close();
    }
  });

  it('rolls back member changes and index creation when the repair fails', () => {
    const db = createLegacyDatabase();
    try {
      db.prepare(`INSERT INTO model_tier_members
        (id, tier_id, provider_id, model_id, position, created_at)
        VALUES ('member-1', 'tier-a', 'provider-a', 'model-a', -1, 10)`).run();
      db.exec(`
        CREATE TRIGGER reject_repair_update BEFORE UPDATE ON model_tier_members
        WHEN NEW.position LIKE '__model_tier_repair_%'
        BEGIN SELECT RAISE(ABORT, 'injected repair failure'); END;
      `);

      expect(() => repairMembers.up(db)).toThrow('injected repair failure');
      expect(db.prepare('SELECT id, position FROM model_tier_members').all())
        .toEqual([{ id: 'member-1', position: -1 }]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mtm_tier_position'").get())
        .toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('provider model tier-reference prefix migration', () => {
  it('retires persisted ambiguous models, safely clears their bindings, and enforces the reserved prefix', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE providers (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE provider_models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          removed_at INTEGER
        );
        CREATE TABLE model_tiers (id TEXT PRIMARY KEY);
        CREATE TABLE model_tier_members (
          id TEXT PRIMARY KEY,
          tier_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL
        );
        CREATE TABLE session_templates (id TEXT PRIMARY KEY, model TEXT, provider_id TEXT);
        CREATE TABLE kanban_lanes (id TEXT PRIMARY KEY, on_enter_model TEXT, on_enter_provider_id TEXT);
        CREATE TABLE project_session_defaults (id TEXT PRIMARY KEY, model TEXT, provider_id TEXT);
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          model TEXT,
          provider_id TEXT,
          pending_model TEXT,
          pending_provider_id TEXT,
          resolved_model TEXT,
          resolved_provider_id TEXT
        );
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
      `);
      db.prepare('INSERT INTO providers (id, enabled) VALUES (?, ?)').run('provider-a', 1);
      db.prepare(`INSERT INTO provider_models (id, provider_id, model_id, enabled, removed_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run('bad-model', 'provider-a', 'tier::legacy-model', 1, null);
      db.prepare(`INSERT INTO provider_models (id, provider_id, model_id, enabled, removed_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run('safe-model', 'provider-a', 'safe-model', 1, null);
      db.prepare('INSERT INTO model_tiers (id) VALUES (?), (?)').run('legacy-tier', 'healthy-tier');
      db.prepare(`INSERT INTO model_tier_members (id, tier_id, provider_id, model_id)
        VALUES (?, ?, ?, ?), (?, ?, ?, ?)`)
        .run(
          'bad-member', 'legacy-tier', 'provider-a', 'tier::legacy-model',
          'safe-member', 'healthy-tier', 'provider-a', 'safe-model'
        );
      db.prepare('INSERT INTO session_templates (id, model, provider_id) VALUES (?, ?, ?)')
        .run('template', 'tier::legacy-model', 'provider-a');
      db.prepare('INSERT INTO kanban_lanes (id, on_enter_model, on_enter_provider_id) VALUES (?, ?, ?)')
        .run('lane', 'tier::legacy-model', 'provider-a');
      db.prepare('INSERT INTO project_session_defaults (id, model, provider_id) VALUES (?, ?, ?)')
        .run('defaults', 'tier::legacy-model', 'provider-a');
      db.prepare(`INSERT INTO sessions
        (id, model, provider_id, pending_model, pending_provider_id, resolved_model, resolved_provider_id)
        VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, NULL, NULL, NULL, NULL), (?, ?, ?, NULL, NULL, NULL, NULL)`)
        .run(
          'concrete-session', 'tier::legacy-model', 'provider-a', 'tier::legacy-model', 'provider-a', 'tier::legacy-model', 'provider-a',
          'empty-tier-session', 'tier::legacy-tier', null,
          'healthy-tier-session', 'tier::healthy-tier', null
        );
      db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run('summary_settings', JSON.stringify({ summaryModel: 'tier::legacy-model', summaryProviderId: 'provider-a' }), 1);

      reserveTierReferencePrefix.up(db);
      reserveTierReferencePrefix.up(db);

      expect(db.prepare('SELECT enabled, removed_at FROM provider_models WHERE id = ?').get('bad-model'))
        .toMatchObject({ enabled: 0, removed_at: expect.any(Number) });
      expect(db.prepare('SELECT id FROM model_tier_members WHERE id = ?').get('bad-member')).toBeUndefined();
      expect(db.prepare('SELECT id FROM model_tier_members WHERE id = ?').get('safe-member')).toBeDefined();
      for (const [table, id, modelColumn, providerColumn] of [
        ['session_templates', 'template', 'model', 'provider_id'],
        ['kanban_lanes', 'lane', 'on_enter_model', 'on_enter_provider_id'],
        ['project_session_defaults', 'defaults', 'model', 'provider_id'],
      ]) {
        expect(db.prepare(`SELECT ${modelColumn} AS model, ${providerColumn} AS providerId FROM ${table} WHERE id = ?`).get(id))
          .toEqual({ model: null, providerId: null });
      }
      expect(db.prepare(`SELECT model, provider_id, pending_model, pending_provider_id,
        resolved_model, resolved_provider_id FROM sessions WHERE id = ?`).get('concrete-session'))
        .toEqual({
          model: null,
          provider_id: null,
          pending_model: null,
          pending_provider_id: null,
          resolved_model: null,
          resolved_provider_id: null,
        });
      expect(db.prepare('SELECT model, provider_id FROM sessions WHERE id = ?').get('empty-tier-session'))
        .toEqual({ model: null, provider_id: null });
      expect(db.prepare('SELECT model, provider_id FROM sessions WHERE id = ?').get('healthy-tier-session'))
        .toEqual({ model: 'tier::healthy-tier', provider_id: null });
      expect(JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get('summary_settings').value))
        .toMatchObject({ summaryModel: '', summaryProviderId: null });

      expect(() => db.prepare(`INSERT INTO provider_models (id, provider_id, model_id, enabled)
        VALUES (?, ?, ?, ?)`)
        .run('another-bad-model', 'provider-a', 'tier::another-tier', 1))
        .toThrow(/reserved tier:: prefix/);
      expect(() => db.prepare('UPDATE provider_models SET model_id = ? WHERE id = ?')
        .run('tier::renamed', 'safe-model'))
        .toThrow(/reserved tier:: prefix/);
    } finally {
      db.close();
    }
  });
});
