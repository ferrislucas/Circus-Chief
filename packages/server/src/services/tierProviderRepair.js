/**
 * tierProviderRepair.js — repair dependent CONCRETE (model, providerId) pairs
 * ahead of a provider row's deletion.
 *
 * A concrete pair is one atomic identity: when its provider goes away the
 * model half goes with it ("do not retain an orphan model" — a bare model id
 * would silently re-resolve against a different provider or SDK defaults).
 *
 * Runs BEFORE the provider row is deleted, inside the caller's transaction:
 * upgraded-schema provider columns are declared `REFERENCES providers(id)`
 * (NO ACTION), so deleting first would fail closed, and repairing first keeps
 * fresh-schema databases (no FK, or columns absent entirely) coherent too.
 * Tier-bound sessions keep their tier ref — only the dead provider
 * association and stale snapshots are cleared; the emptied-tier sweep owns
 * the tier half and runs afterwards.
 *
 * Every helper tolerates missing tables/columns (fresh vs. upgraded schemas)
 * and returns what it changed so the orchestrator can build one publishable
 * change set — or null when nothing referenced the provider.
 */

import { isTierRef } from '@circuschief/shared';

const SUMMARY_SETTINGS_KEY = 'summary_settings';

function tableColumns(db, table) {
  const exists = db.prepare(
    'SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?'
  ).get(table);
  if (!exists) return null;
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function hasAllColumns(db, table, columns) {
  const available = tableColumns(db, table);
  return available !== null && columns.every((column) => available.has(column));
}

function repairTemplateReferences(db, providerId, now) {
  if (!hasAllColumns(db, 'session_templates', ['model', 'provider_id'])) return [];
  const rows = db.prepare('SELECT id FROM session_templates WHERE provider_id = ?').all(providerId);
  if (rows.length === 0) return [];
  db.prepare(
    'UPDATE session_templates SET model = NULL, provider_id = NULL, updated_at = ? WHERE provider_id = ?'
  ).run(now, providerId);
  return rows.map((row) => row.id);
}

function repairLaneReferences(db, providerId, now) {
  if (!hasAllColumns(db, 'kanban_lanes', ['on_enter_model', 'on_enter_provider_id'])) {
    return { projectIds: [], repaired: false };
  }
  const projectIds = [];
  if (hasAllColumns(db, 'kanban_boards', ['project_id'])) {
    const rows = db.prepare(
      `SELECT DISTINCT b.project_id AS projectId
       FROM kanban_lanes l
       JOIN kanban_boards b ON b.id = l.board_id
       WHERE l.on_enter_provider_id = ?`
    ).all(providerId);
    for (const row of rows) projectIds.push(row.projectId);
  }
  const result = db.prepare(
    `UPDATE kanban_lanes
     SET on_enter_model = NULL, on_enter_provider_id = NULL, updated_at = ?
     WHERE on_enter_provider_id = ?`
  ).run(now, providerId);
  return { projectIds, repaired: result.changes > 0 };
}

function repairProjectDefaultReferences(db, providerId, now) {
  if (!hasAllColumns(db, 'project_session_defaults', ['model', 'provider_id'])) return [];
  const rows = db.prepare(
    'SELECT project_id AS projectId FROM project_session_defaults WHERE provider_id = ?'
  ).all(providerId);
  if (rows.length === 0) return [];
  db.prepare(
    'UPDATE project_session_defaults SET model = NULL, provider_id = NULL, updated_at = ? WHERE provider_id = ?'
  ).run(now, providerId);
  return rows.map((row) => row.projectId);
}

function sessionSnapshotHalves(sessionColumns) {
  return [
    ['resolved_model', 'resolved_provider_id'],
    ['last_executed_model', 'last_executed_provider_id'],
  ].filter(([modelColumn, providerColumn]) =>
    sessionColumns.has(modelColumn) && sessionColumns.has(providerColumn)
  );
}

function sessionProviderReferenceScope(db, providerId) {
  const sessionColumns = tableColumns(db, 'sessions');
  if (!sessionColumns?.has('provider_id')) return null;
  const halves = sessionSnapshotHalves(sessionColumns);
  const whereParts = ['provider_id = ?'];
  const whereArgs = [providerId];
  for (const [, providerColumn] of halves) {
    whereParts.push(`${providerColumn} = ?`);
    whereArgs.push(providerId);
  }
  const pendingGuarded = sessionColumns.has('pending_model')
    && sessionColumns.has('pending_provider_id');
  if (pendingGuarded) {
    whereParts.push('pending_provider_id = ?');
    whereArgs.push(providerId);
  }
  const where = `WHERE ${whereParts.join(' OR ')}`;
  const rows = db.prepare(`SELECT id, project_id AS projectId FROM sessions ${where}`).all(...whereArgs);
  return { rows, halves, pendingGuarded, where, whereArgs };
}

function clearSessionProviderReferences(db, scope, providerId, now) {
  const { halves, pendingGuarded, where, whereArgs } = scope;
  const snapshotSets = halves.map(([modelColumn, providerColumn]) =>
    `${modelColumn} = CASE WHEN ${providerColumn} = ? THEN NULL ELSE ${modelColumn} END, ` +
    `${providerColumn} = CASE WHEN ${providerColumn} = ? THEN NULL ELSE ${providerColumn} END`
  );
  const snapshotArgs = halves.flatMap(() => [providerId, providerId]);
  // Each persisted pair is repaired independently: the current
  // (model, provider_id) pair clears only when its own provider half names
  // the deleted provider — a row selected merely through a pending selection
  // or a historical snapshot keeps its valid current binding. A tier-bound
  // session keeps its tier ref (the emptied-tier sweep owns that half) but
  // drops the dead provider association. SQLite evaluates every RHS against
  // the pre-update row, so snapshots clear atomically with the binding.
  db.prepare(
    `UPDATE sessions
     SET model = CASE WHEN provider_id = ?
                     THEN CASE WHEN model LIKE 'tier::%' THEN model ELSE NULL END
                     ELSE model END,
         provider_id = CASE WHEN provider_id = ? THEN NULL ELSE provider_id END,
         ${snapshotSets.length > 0 ? `${snapshotSets.join(', ')}, ` : ''}
         updated_at = ?
     ${where}`
  ).run(providerId, providerId, ...snapshotArgs, now, ...whereArgs);
  if (pendingGuarded) {
    db.prepare(
      `UPDATE sessions
       SET pending_model = NULL, pending_provider_id = NULL, updated_at = ?
       WHERE pending_provider_id = ?`
    ).run(now, providerId);
  }
}

function repairSessionReferences(db, providerId, now) {
  const scope = sessionProviderReferenceScope(db, providerId);
  if (!scope || scope.rows.length === 0) return [];
  clearSessionProviderReferences(db, scope, providerId, now);
  const seen = new Set();
  const affected = [];
  for (const row of scope.rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    affected.push({ id: row.id, projectId: row.projectId });
  }
  return affected;
}

function repairSummarySettings(db, providerId, now) {
  if (!hasAllColumns(db, 'app_settings', ['key', 'value'])) return false;
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SUMMARY_SETTINGS_KEY);
  if (!row) return false;
  try {
    const parsed = JSON.parse(row.value);
    // A tier-ref summary model stays owned by the tier machinery even when
    // its provider half names the deleted provider.
    if (!parsed || typeof parsed !== 'object'
      || parsed.summaryProviderId !== providerId
      || isTierRef(parsed.summaryModel)) {
      return false;
    }
    parsed.summaryModel = '';
    parsed.summaryProviderId = null;
    db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
      .run(JSON.stringify(parsed), now, SUMMARY_SETTINGS_KEY);
    return true;
  } catch {
    // Malformed settings are handled by SettingsRepository's fallback.
    return false;
  }
}

function providerDegradedFrom(db, providerId) {
  try {
    const provider = db.prepare('SELECT name FROM providers WHERE id = ?').get(providerId);
    if (provider?.name) return `provider:${provider.name}`;
  } catch {
    // The providers table shape is not guaranteed on every schema — the id
    // fallback below already identifies the cause.
  }
  return `provider:${providerId}`;
}

/**
 * Repair every persisted concrete pair naming `providerId`, ahead of that
 * provider row's deletion. Must run inside the caller's transaction (same
 * rationale as tierDeletionService's degradeTierReferences). Returns a
 * publishable change set in the degradation shape (with
 * `degradedFrom: 'provider:<name>'`) — or null when nothing referenced the
 * provider.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} providerId
 * @param {number} now
 * @returns {Object|null} Change set for post-commit publish, or null.
 */
export function repairConcreteProviderReferences(db, providerId, now) {
  const affectedTemplateIds = repairTemplateReferences(db, providerId, now);
  const lanes = repairLaneReferences(db, providerId, now);
  const projectDefaultProjectIds = repairProjectDefaultReferences(db, providerId, now);
  const affectedSessions = repairSessionReferences(db, providerId, now);
  const summarySettingsChanged = repairSummarySettings(db, providerId, now);

  const changed = affectedSessions.length > 0
    || affectedTemplateIds.length > 0
    || projectDefaultProjectIds.length > 0
    || lanes.projectIds.length > 0
    || lanes.repaired
    || summarySettingsChanged;
  if (!changed) return null;

  return {
    degradedFrom: providerDegradedFrom(db, providerId),
    affectedSessions,
    affectedTemplateIds,
    projectDefaultProjectIds,
    laneProjectIds: lanes.projectIds,
    summarySettingsChanged,
  };
}
