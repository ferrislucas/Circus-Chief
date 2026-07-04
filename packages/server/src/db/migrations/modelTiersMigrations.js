import { addColumnIfMissing, tableExists } from './migrationUtils.js';

export const modelTiersMigrations = [
  {
    name: 'model_tiers-create-tables',
    up(db) {
      if (!tableExists(db, 'model_tiers')) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS model_tiers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
          );

          CREATE TABLE IF NOT EXISTS model_tier_members (
            id TEXT PRIMARY KEY,
            tier_id TEXT NOT NULL REFERENCES model_tiers(id) ON DELETE CASCADE,
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            model_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
          );

          CREATE INDEX IF NOT EXISTS idx_mtm_tier ON model_tier_members(tier_id);
        `);
      }
    },
  },
  {
    name: 'sessions-add-resolved_model',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'resolved_model', 'TEXT');
      addColumnIfMissing(db, 'sessions', 'resolved_provider_id', 'TEXT');
    },
  },
];
