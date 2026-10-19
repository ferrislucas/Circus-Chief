import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { modelTiersMigrations } from './modelTiersMigrations.js';

const autoFailoverFlag = modelTiersMigrations.find(
  (migration) => migration.name === 'model-tiers-auto-failover-flag'
);

// Legacy shape: the model_tiers table as created before the flag existed
// (no auto_failover_enabled column) with a pre-existing row.
function createLegacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_tiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    'INSERT INTO model_tiers (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('legacy-tier', 'Legacy Tier', null, 1000, 1000);
  return db;
}

describe('model tiers auto-failover flag migration', () => {
  it('is registered in the migration list', () => {
    expect(autoFailoverFlag).toBeDefined();
  });

  it('adds auto_failover_enabled as NOT NULL DEFAULT 1', () => {
    const db = createLegacyDatabase();
    try {
      autoFailoverFlag.up(db);
      const columns = db.prepare('PRAGMA table_info(model_tiers)').all();
      const flag = columns.find((column) => column.name === 'auto_failover_enabled');
      expect(flag).toBeDefined();
      expect(flag.notnull).toBe(1);
      expect(flag.dflt_value).toBe('1');
    } finally {
      db.close();
    }
  });

  it('backfills legacy rows as enabled', () => {
    const db = createLegacyDatabase();
    try {
      autoFailoverFlag.up(db);
      const row = db.prepare('SELECT auto_failover_enabled FROM model_tiers WHERE id = ?').get('legacy-tier');
      expect(row.auto_failover_enabled).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-run', () => {
    const db = createLegacyDatabase();
    try {
      autoFailoverFlag.up(db);
      expect(() => autoFailoverFlag.up(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});
