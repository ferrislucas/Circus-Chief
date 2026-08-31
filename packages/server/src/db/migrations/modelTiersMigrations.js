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
            created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
            UNIQUE(tier_id, provider_id, model_id),
            UNIQUE(tier_id, position)
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
  {
    name: 'model-tiers-provider-pair-columns',
    up(db) {
      addColumnIfMissing(db, 'session_templates', 'provider_id', 'TEXT REFERENCES providers(id)');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_provider_id', 'TEXT REFERENCES providers(id)');
      addColumnIfMissing(db, 'sessions', 'pending_provider_id', 'TEXT REFERENCES providers(id)');
    },
  },
  {
    name: 'model-tiers-repair-members-and-unique-indexes',
    up(db) {
      // Existing development databases predate the constraints. Keep the first
      // deterministic pair then make its positions canonical before indexing.
      db.transaction(() => {
        const rows = db.prepare(`SELECT id, tier_id, provider_id, model_id
          FROM model_tier_members ORDER BY tier_id, position ASC, created_at ASC, id ASC`).all();
        const seen = new Set();
        const keep = [];
        for (const row of rows) {
          const key = `${row.tier_id}\u0000${row.provider_id}\u0000${row.model_id}`;
          if (seen.has(key)) {
            db.prepare('DELETE FROM model_tier_members WHERE id = ?').run(row.id);
          } else {
            seen.add(key);
            keep.push(row);
          }
        }
        let tierId = null;
        let position = 0;
        for (const row of keep) {
          if (row.tier_id !== tierId) { tierId = row.tier_id; position = 0; }
          db.prepare('UPDATE model_tier_members SET position = ? WHERE id = ?').run(position++, row.id);
        }
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mtm_tier_provider_model ON model_tier_members(tier_id, provider_id, model_id)');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mtm_tier_position ON model_tier_members(tier_id, position)');
      })();
    },
  },
];
