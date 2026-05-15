import { normalizeCommitAttributionOverride } from '@circuschief/shared/contracts/providers';
import { tableExists } from './migrationUtils.js';

function normalizeProviderCommitAttributionOverrides(db) {
  if (!tableExists(db, 'providers')) return;
  const rows = db
    .prepare('SELECT id, commit_attribution_override FROM providers WHERE commit_attribution_override IS NOT NULL')
    .all();
  const update = db.prepare('UPDATE providers SET commit_attribution_override = ? WHERE id = ?');

  for (const row of rows) {
    try {
      const normalized = normalizeCommitAttributionOverride(row.commit_attribution_override);
      if (normalized !== row.commit_attribution_override) {
        update.run(normalized, row.id);
      }
    } catch {
      // Irrecoverable legacy values, such as bare emails, are preserved until edited.
    }
  }
}

export const providerCommitAttributionMigrations = [
  {
    name: 'providers-normalize-commit_attribution_override',
    up(db) {
      normalizeProviderCommitAttributionOverrides(db);
    },
  },
];
