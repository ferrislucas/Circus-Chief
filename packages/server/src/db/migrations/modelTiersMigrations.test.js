import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { modelTiersMigrations } from './modelTiersMigrations.js';

const repairMembers = modelTiersMigrations.find(
  (migration) => migration.name === 'model-tiers-repair-members-and-unique-indexes'
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
