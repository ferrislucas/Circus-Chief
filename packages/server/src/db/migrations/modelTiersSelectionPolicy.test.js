import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { modelTiersMigrations } from './modelTiersMigrations.js';

const selectionPolicy = modelTiersMigrations.find(
  (migration) => migration.name === 'model-tiers-selection-policy'
);

function createLegacyDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_tiers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      auto_failover_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    'INSERT INTO model_tiers (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('legacy-tier', 'Legacy Tier', null, 1000, 1000);
  return db;
}

describe('model tiers selection policy migration', () => {
  it('is registered in the migration list', () => {
    expect(selectionPolicy).toBeDefined();
  });

  it('adds sequential mode and a null floor to legacy rows', () => {
    const db = createLegacyDatabase();
    try {
      selectionPolicy.up(db);
      const row = db.prepare('SELECT selection_mode, min_remaining_percent FROM model_tiers WHERE id = ?').get('legacy-tier');
      expect(row.selection_mode).toBe('sequential');
      expect(row.min_remaining_percent).toBeNull();
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-run', () => {
    const db = createLegacyDatabase();
    try {
      selectionPolicy.up(db);
      expect(() => selectionPolicy.up(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});
