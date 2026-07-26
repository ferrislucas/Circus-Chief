import { databaseManager } from './DatabaseManager.js';

/**
 * Pure, `db`-first operations backing `ProviderRepository`'s model-management
 * methods (getModels/addModel/updateModel/removeModel/reorderModels/
 * getHistoricalModel). Extracted to a standalone module purely to keep
 * ProviderRepository.js under the project's max-lines lint budget; these
 * functions have no behavior of their own beyond what the repository
 * previously implemented inline.
 */

const MODEL_UPDATE_COLUMN_BUILDERS = Object.freeze({
  modelId: (value) => ['model_id = ?', value],
  displayName: (value) => ['display_name = ?', value],
  description: (value) => ['description = ?', value],
  tier: (value) => ['tier = ?', value],
  enabled: (value) => ['enabled = ?', value ? 1 : 0],
  sortOrder: (value) => ['sort_order = ?', value],
});

export function buildModelUpdateColumns(data = {}) {
  return Object.entries(MODEL_UPDATE_COLUMN_BUILDERS).reduce(
    (result, [field, buildColumn]) => {
      if (data[field] === undefined) return result;

      const [update, value] = buildColumn(data[field]);
      result.updates.push(update);
      result.values.push(value);
      return result;
    },
    { updates: [], values: [] }
  );
}

export function mapProviderModel(row) {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    displayName: row.display_name,
    description: row.description,
    tier: row.tier,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order ?? null,
    lifecycle: row.lifecycle || 'current',
    catalogManaged: row.catalog_managed === 1,
    removedAt: row.removed_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * @param {{ includeRemoved?: boolean }} [options] - Pass `includeRemoved: true`
 *   to include soft-removed (tombstoned) rows. Normal list/picker callers
 *   must never see removed rows; historical resolution uses
 *   `getHistoricalModel` / `getModelById` instead.
 */
export function getModels(db, providerId, { includeRemoved = false } = {}) {
  const removedClause = includeRemoved ? '' : 'AND removed_at IS NULL';
  const rows = db
    .prepare(
      `SELECT * FROM provider_models WHERE provider_id = ? ${removedClause}
       ORDER BY (sort_order IS NULL), sort_order ASC, created_at ASC, rowid ASC`
    )
    .all(providerId);
  return rows.map(mapProviderModel);
}

export function nextSortOrder(db, providerId) {
  return db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM provider_models WHERE provider_id = ?')
    .get(providerId).nextOrder;
}

export function getModelById(db, id) {
  const row = db.prepare('SELECT * FROM provider_models WHERE id = ?').get(id);
  return row ? mapProviderModel(row) : null;
}

/**
 * Resolve the row a session should use to keep displaying/running a given
 * (provider, modelId string) pair, even if it has since been disabled or
 * soft-removed. Prefers the active row (covers the common disabled-but-
 * still-listed case); falls back to the most recently removed row.
 * @param {string} modelId - The model string (e.g. 'claude-opus-4-7'), not a row id.
 */
export function getHistoricalModel(db, providerId, modelId) {
  if (!providerId || !modelId) return null;
  const row = db
    .prepare(
      `SELECT * FROM provider_models WHERE provider_id = ? AND model_id = ?
       ORDER BY (removed_at IS NULL) DESC, created_at DESC LIMIT 1`
    )
    .get(providerId, modelId);
  return row ? mapProviderModel(row) : null;
}

/**
 * Add a model to a provider. Built-in and custom providers share this path
 * (FRD-built-in-model-choices.md §0 "users can add and remove model choices
 * for built-in providers just as they can for custom providers").
 *
 * If a soft-removed row already exists for this (provider, modelId) pair, it
 * is restored and updated in place rather than duplicated, so historical
 * continuity for sessions that reference it is preserved through a single
 * canonical row.
 */
export function addModel(db, providerId, data) {
  const { modelId, displayName, description = null, tier = 'custom', enabled = true } = data;

  const active = db
    .prepare('SELECT id FROM provider_models WHERE provider_id = ? AND model_id = ? AND removed_at IS NULL')
    .get(providerId, modelId);
  if (active) {
    throw new Error(`A model with id "${modelId}" already exists for this provider`);
  }

  const removed = db
    .prepare(
      `SELECT id FROM provider_models WHERE provider_id = ? AND model_id = ? AND removed_at IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(providerId, modelId);

  if (removed) {
    const sortOrder = data.sortOrder ?? nextSortOrder(db, providerId);
    db.prepare(
      `UPDATE provider_models
       SET display_name = ?, description = ?, tier = ?, enabled = ?, sort_order = ?, removed_at = NULL
       WHERE id = ?`
    ).run(displayName, description, tier, enabled ? 1 : 0, sortOrder, removed.id);
    return getModelById(db, removed.id);
  }

  const id = databaseManager.generateId();
  const now = Date.now();
  const sortOrder = data.sortOrder ?? nextSortOrder(db, providerId);

  db.prepare(
    `INSERT INTO provider_models (id, provider_id, model_id, display_name, description, tier, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, providerId, modelId, displayName, description, tier, enabled ? 1 : 0, sortOrder, now);

  return getModelById(db, id);
}

/**
 * @param {{ current: Object, provider: Object|null }} context - The model row
 *   and its owning provider (both already fetched by the caller).
 */
export function updateModel(db, id, data, { current, provider }) {
  if (provider?.isBuiltIn && data.modelId !== undefined && data.modelId !== current.modelId) {
    throw new Error('Cannot change the model id of a built-in provider model');
  }
  const { updates, values } = buildModelUpdateColumns(data);

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE provider_models SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return getModelById(db, id);
}

/**
 * Remove a model from a provider. Built-in and custom providers share this
 * path. Removal is a soft-removal (tombstone): the row is kept with
 * `removed_at` set rather than physically deleted, so a session that already
 * references this model id continues to resolve it (FRD-built-in-model-
 * choices.md §0 "Removing a built-in choice must be durable...a removed
 * catalog choice must not silently reappear"). Idempotent -- an
 * already-removed row is returned unchanged rather than erroring.
 * @param {Object} model - The model row (already fetched by the caller).
 */
export function removeModel(db, modelId, model) {
  if (!model.removedAt) {
    db.prepare('UPDATE provider_models SET removed_at = ? WHERE id = ?').run(Date.now(), modelId);
  }
  return getModelById(db, modelId);
}

/**
 * Validate a requested reorder against a provider's existing model rows.
 * Shared by `reorderModels` (below) and the `PUT /:id/models/order` API route
 * (`api/providers.js`), so the rule -- no foreign ids, no duplicates -- is
 * defined exactly once. A partial list (omitting some existing rows) is
 * legitimate and NOT rejected here; omitted rows are simply appended by the
 * caller.
 * @throws {Error} 'Duplicate model ids in reorder request' or
 *   'Model does not belong to this provider'.
 */
export function assertValidReorder(existing, orderedRowIds) {
  const validIds = new Set(existing.map((model) => model.id));
  if (orderedRowIds.some((id) => !validIds.has(id))) {
    throw new Error('Model does not belong to this provider');
  }
  if (new Set(orderedRowIds).size !== orderedRowIds.length) {
    throw new Error('Duplicate model ids in reorder request');
  }
}

export function reorderModels(db, providerId, orderedRowIds) {
  const existing = getModels(db, providerId);
  assertValidReorder(existing, orderedRowIds);
  const requestedIds = new Set(orderedRowIds);
  // Preserve omitted rows and compact every row into one stable sequence.
  const order = [...orderedRowIds, ...existing.filter((model) => !requestedIds.has(model.id)).map((model) => model.id)];
  const update = db.prepare('UPDATE provider_models SET sort_order = ? WHERE id = ? AND provider_id = ?');
  const transaction = db.transaction(() => {
    order.forEach((id, index) => update.run(index, id, providerId));
  });
  transaction();
  return getModels(db, providerId);
}
