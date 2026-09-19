import { addColumnIfMissing, getColumns, tableExists } from './migrationUtils.js';

const TIER_REF_PREFIX = 'tier::';
const RESERVED_TIER_REF_MODEL_ID_SQL_MESSAGE = 'Provider model IDs cannot use the reserved tier:: prefix';

function hasColumns(db, table, columns) {
  return tableExists(db, table) && columns.every((column) => getColumns(db, table).includes(column));
}

function clearLegacyConcreteModelBindings(db) {
  const bindings = [
    ['session_templates', 'model', 'provider_id'],
    ['kanban_lanes', 'on_enter_model', 'on_enter_provider_id'],
    ['project_session_defaults', 'model', 'provider_id'],
    ['sessions', 'model', 'provider_id'],
    ['sessions', 'pending_model', 'pending_provider_id'],
    ['sessions', 'resolved_model', 'resolved_provider_id'],
  ];

  for (const [table, modelColumn, providerColumn] of bindings) {
    if (!hasColumns(db, table, [modelColumn, providerColumn])) continue;
    db.prepare(`
      UPDATE ${table}
      SET ${modelColumn} = NULL, ${providerColumn} = NULL
      WHERE substr(${modelColumn}, 1, ?) = ?
        AND ${providerColumn} IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM provider_models pm
          WHERE pm.provider_id = ${table}.${providerColumn}
            AND pm.model_id = ${table}.${modelColumn}
            AND substr(pm.model_id, 1, ?) = ?
        )
    `).run(TIER_REF_PREFIX.length, TIER_REF_PREFIX, TIER_REF_PREFIX.length, TIER_REF_PREFIX);
  }

  if (!hasColumns(db, 'app_settings', ['key', 'value'])) return;
  const summary = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('summary_settings');
  if (!summary) return;
  try {
    const value = JSON.parse(summary.value);
    if (
      value &&
      typeof value === 'object' &&
      typeof value.summaryModel === 'string' &&
      value.summaryModel.startsWith(TIER_REF_PREFIX) &&
      typeof value.summaryProviderId === 'string' &&
      db.prepare('SELECT 1 FROM provider_models WHERE provider_id = ? AND model_id = ? AND substr(model_id, 1, ?) = ?')
        .get(value.summaryProviderId, value.summaryModel, TIER_REF_PREFIX.length, TIER_REF_PREFIX)
    ) {
      value.summaryModel = '';
      value.summaryProviderId = null;
      db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
        .run(JSON.stringify(value), Date.now(), 'summary_settings');
    }
  } catch {
    // Malformed settings are handled by SettingsRepository's existing fallback.
  }
}

function tierHasExecutableMember(db, tierId) {
  if (!hasColumns(db, 'model_tier_members', ['tier_id', 'provider_id', 'model_id'])) return false;
  return Boolean(db.prepare(`
    SELECT 1
    FROM model_tier_members member
    JOIN providers provider ON provider.id = member.provider_id
    JOIN provider_models model
      ON model.provider_id = member.provider_id AND model.model_id = member.model_id
    WHERE member.tier_id = ?
      AND provider.enabled = 1
      AND model.enabled = 1
      AND model.removed_at IS NULL
    LIMIT 1
  `).get(tierId));
}

function clearTierReferenceBindings(db, table, modelColumn, providerColumn) {
  if (!hasColumns(db, table, [modelColumn, providerColumn])) return;
  const refs = db.prepare(`SELECT DISTINCT ${modelColumn} AS model FROM ${table} WHERE substr(${modelColumn}, 1, ?) = ?`)
    .all(TIER_REF_PREFIX.length, TIER_REF_PREFIX)
    .map(({ model }) => model)
    .filter((model) => !tierHasExecutableMember(db, model.slice(TIER_REF_PREFIX.length)));
  const clearSnapshots = table === 'sessions' && modelColumn === 'model'
    ? ', resolved_model = NULL, resolved_provider_id = NULL'
    : '';
  for (const ref of refs) {
    db.prepare(`UPDATE ${table}
      SET ${modelColumn} = NULL, ${providerColumn} = NULL${clearSnapshots}
      WHERE ${modelColumn} = ?`).run(ref);
  }
}

function clearUnresolvableSummaryTierReference(db) {
  if (!hasColumns(db, 'app_settings', ['key', 'value'])) return;
  const summary = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('summary_settings');
  if (!summary) return;
  try {
    const value = JSON.parse(summary.value);
    if (
      value &&
      typeof value === 'object' &&
      typeof value.summaryModel === 'string' &&
      value.summaryModel.startsWith(TIER_REF_PREFIX) &&
      !tierHasExecutableMember(db, value.summaryModel.slice(TIER_REF_PREFIX.length))
    ) {
      value.summaryModel = '';
      value.summaryProviderId = null;
      db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
        .run(JSON.stringify(value), Date.now(), 'summary_settings');
    }
  } catch {
    // Malformed settings are handled by SettingsRepository's existing fallback.
  }
}

function clearUnresolvableTierReferences(db) {
  for (const binding of [
    ['session_templates', 'model', 'provider_id'],
    ['kanban_lanes', 'on_enter_model', 'on_enter_provider_id'],
    ['project_session_defaults', 'model', 'provider_id'],
    ['sessions', 'model', 'provider_id'],
    ['sessions', 'pending_model', 'pending_provider_id'],
  ]) {
    clearTierReferenceBindings(db, ...binding);
  }
  clearUnresolvableSummaryTierReference(db);
}

function createReservedModelIdTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_provider_models_reject_tier_ref_model_id_insert
    BEFORE INSERT ON provider_models
    FOR EACH ROW WHEN substr(NEW.model_id, 1, ${TIER_REF_PREFIX.length}) = '${TIER_REF_PREFIX}'
    BEGIN SELECT RAISE(ABORT, '${RESERVED_TIER_REF_MODEL_ID_SQL_MESSAGE}'); END;

    CREATE TRIGGER IF NOT EXISTS trg_provider_models_reject_tier_ref_model_id_update
    BEFORE UPDATE OF model_id ON provider_models
    FOR EACH ROW WHEN substr(NEW.model_id, 1, ${TIER_REF_PREFIX.length}) = '${TIER_REF_PREFIX}'
    BEGIN SELECT RAISE(ABORT, '${RESERVED_TIER_REF_MODEL_ID_SQL_MESSAGE}'); END;
  `);
}

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
      //
      // Position repairs need two passes. A database which was opened by an
      // earlier version of this migration can already have a uniqueness
      // constraint/index on (tier_id, position); assigning final positions in
      // place can then collide with a row that has not yet moved. Temporary
      // TEXT values are valid in SQLite's non-STRICT INTEGER columns and let
      // every retained row move out of the final position space first.
      db.transaction(() => {
        const rows = db.prepare(`SELECT id, tier_id, provider_id, model_id, position
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

        // Do not assume that legacy position values are numeric or that a
        // previous partial migration did not leave arbitrary values behind.
        // Pick values outside the complete existing set so this pass is safe
        // even when the old table already has a uniqueness constraint.
        const occupiedPositions = new Set(rows.map((row) => String(row.position)));
        const temporaryPositionFor = (row, sequence) => {
          let candidate = `__model_tier_repair_${sequence}_${row.id}__`;
          while (occupiedPositions.has(candidate)) candidate = `_${candidate}`;
          occupiedPositions.add(candidate);
          return candidate;
        };
        const setTemporaryPosition = db.prepare('UPDATE model_tier_members SET position = ? WHERE id = ?');
        keep.forEach((row, index) => setTemporaryPosition.run(temporaryPositionFor(row, index), row.id));

        let tierId = null;
        let position = 0;
        const setFinalPosition = db.prepare('UPDATE model_tier_members SET position = ? WHERE id = ?');
        for (const row of keep) {
          if (row.tier_id !== tierId) { tierId = row.tier_id; position = 0; }
          setFinalPosition.run(position++, row.id);
        }
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mtm_tier_provider_model ON model_tier_members(tier_id, provider_id, model_id)');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mtm_tier_position ON model_tier_members(tier_id, position)');
      })();
    },
  },
  {
    name: 'provider-models-reserve-tier-reference-prefix',
    up(db) {
      if (!hasColumns(db, 'provider_models', ['model_id', 'removed_at', 'enabled'])) return;

      db.transaction(() => {
        // Earlier builds could register these ambiguous ids. Retire the rows
        // (rather than silently interpreting them as tiers), clear only
        // unambiguous provider-paired bindings, and remove invalid tier
        // members before enforcing the invariant for every future write.
        clearLegacyConcreteModelBindings(db);
        if (hasColumns(db, 'model_tier_members', ['model_id'])) {
          db.prepare('DELETE FROM model_tier_members WHERE substr(model_id, 1, ?) = ?')
            .run(TIER_REF_PREFIX.length, TIER_REF_PREFIX);
        }
        db.prepare(`UPDATE provider_models
          SET enabled = 0, removed_at = COALESCE(removed_at, ?)
          WHERE substr(model_id, 1, ?) = ?`)
          .run(Date.now(), TIER_REF_PREFIX.length, TIER_REF_PREFIX);
        clearUnresolvableTierReferences(db);
        createReservedModelIdTriggers(db);
      })();
    },
  },
];
