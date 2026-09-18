import { databaseManager } from '../db/DatabaseManager.js';
import { buildTierRef, isTierRef, parseTierRef } from '@circuschief/shared';

const SUMMARY_SETTINGS_KEY = 'summary_settings';

/**
 * Return the first member that remains executable at deletion time. This is
 * deliberately cooldown-blind: a cooldown is a transient retry hint, whereas
 * deleting a tier must leave durable configuration pointing at a real model.
 */
function getActiveFallbackMember(db, tierId) {
  return db.prepare(
    `SELECT m.provider_id AS providerId, m.model_id AS modelId, p.kind AS providerKind
     FROM model_tier_members m
     JOIN providers p ON p.id = m.provider_id
     JOIN provider_models pm
       ON pm.provider_id = m.provider_id
      AND pm.model_id = m.model_id
      AND pm.removed_at IS NULL
     WHERE m.tier_id = ?
       AND p.enabled = 1
       AND pm.enabled = 1
     ORDER BY m.position ASC, m.created_at ASC
     LIMIT 1`
  ).get(tierId) || null;
}

/**
 * Existential form of the executable-member predicate (same eligibility rules
 * as {@link getActiveFallbackMember} and `getTierMembersResolved`): the
 * provider exists and is enabled, and it owns a registered, enabled,
 * non-removed model row for the member.
 */
function hasExecutableMember(db, tierId) {
  return Boolean(db.prepare(
    `SELECT 1
     FROM model_tier_members m
     JOIN providers p ON p.id = m.provider_id
     JOIN provider_models pm
       ON pm.provider_id = m.provider_id
      AND pm.model_id = m.model_id
      AND pm.removed_at IS NULL
     WHERE m.tier_id = ?
       AND p.enabled = 1
       AND pm.enabled = 1
     LIMIT 1`
  ).get(tierId));
}

function rewriteSummarySettings(db, tierRef, fallback, now) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SUMMARY_SETTINGS_KEY);
  if (!row) return;

  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    // A malformed value cannot reliably contain a usable tier reference; keep
    // the repository's normal safe-default read behavior intact.
    return;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.summaryModel !== tierRef) return;

  // Summary dispatch supports every executable provider kind that can appear
  // in a tier, so any active member is a routable fallback. Only clear when
  // the tier has no active member at all.
  parsed.summaryModel = fallback ? fallback.modelId : '';
  parsed.summaryProviderId = fallback ? fallback.providerId : null;
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(JSON.stringify(parsed), now, SUMMARY_SETTINGS_KEY);
}

/**
 * Atomically rewrite every forward-looking persisted tier reference from
 * `tierRef` to `fallback` (a concrete member), or clear them when `fallback`
 * is null — the product's existing "use the configured/default model"
 * behavior for each surface. Callers must run this inside a transaction so no
 * reader can observe the tier gone while any configuration still points at
 * its sentinel.
 *
 * Existing sessions keep their own last-resolved concrete member when they
 * have one AND that member's provider still exists — a snapshot naming a
 * provider that no longer exists is unusable and is cleared along with the
 * rest. (A snapshot whose model row was merely soft-removed is retained:
 * historical continuity keeps such sessions runnable.)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tierRef
 * @param {{ providerId: string, modelId: string } | null} fallback
 * @param {number} now
 */
function degradeTierReferences(db, tierRef, fallback, now) {
  const fallbackModel = fallback?.modelId ?? null;
  const fallbackProviderId = fallback?.providerId ?? null;

  db.prepare(
    `UPDATE session_templates
     SET model = ?, provider_id = ?, updated_at = ?
     WHERE model = ?`
  ).run(fallbackModel, fallbackProviderId, now, tierRef);

  db.prepare(
    `UPDATE kanban_lanes
     SET on_enter_model = ?, on_enter_provider_id = ?, updated_at = ?
     WHERE on_enter_model = ?`
  ).run(fallbackModel, fallbackProviderId, now, tierRef);

  db.prepare(
    `UPDATE project_session_defaults
     SET model = ?, provider_id = ?, updated_at = ?
     WHERE model = ?`
  ).run(fallbackModel, fallbackProviderId, now, tierRef);

  // Current and pending selections are deliberately independent pairs.
  // In particular, a pending-only tier ref must never overwrite the current
  // provider or its resolved snapshot.
  // A session may have failed over beyond the tier's first active member.
  // Pin it to its own last-resolved concrete model so losing the tier does
  // not silently move an established conversation back to another provider —
  // but only while that member's provider still exists (see docstring).
  // SQLite evaluates every RHS against the pre-update row, so the snapshot
  // can be consumed and then cleared atomically as the tier ref becomes a
  // concrete binding.
  db.prepare(
    `UPDATE sessions
     SET model = CASE
           WHEN resolved_model IS NOT NULL
            AND resolved_provider_id IN (SELECT id FROM providers)
           THEN resolved_model
           ELSE ?
         END,
         provider_id = CASE
           WHEN resolved_model IS NOT NULL
            AND resolved_provider_id IN (SELECT id FROM providers)
           THEN resolved_provider_id
           ELSE ?
         END,
         resolved_model = NULL,
         resolved_provider_id = NULL,
         updated_at = ?
     WHERE model = ?`
  ).run(fallbackModel, fallbackProviderId, now, tierRef);

  db.prepare(
    `UPDATE sessions
     SET pending_model = ?, pending_provider_id = ?, updated_at = ?
     WHERE pending_model = ?`
  ).run(fallbackModel, fallbackProviderId, now, tierRef);

  rewriteSummarySettings(db, tierRef, fallback, now);
}

/**
 * Collect every tier id that at least one persisted consumer still references
 * via its `tier::<id>` sentinel (sessions, templates, lanes, project defaults,
 * and summary settings).
 */
function findReferencedTierIds(db) {
  const tierIds = new Set();
  const scan = (sql) => {
    for (const row of db.prepare(sql).all()) {
      const tierId = parseTierRef(Object.values(row)[0]);
      if (tierId) tierIds.add(tierId);
    }
  };

  scan(`SELECT model FROM session_templates WHERE model LIKE 'tier::%'`);
  scan(`SELECT on_enter_model FROM kanban_lanes WHERE on_enter_model LIKE 'tier::%'`);
  scan(`SELECT model FROM project_session_defaults WHERE model LIKE 'tier::%'`);
  scan(`SELECT model FROM sessions WHERE model LIKE 'tier::%'`);
  scan(`SELECT pending_model FROM sessions WHERE pending_model LIKE 'tier::%'`);

  const summaryRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SUMMARY_SETTINGS_KEY);
  if (summaryRow) {
    try {
      const summaryModel = JSON.parse(summaryRow.value)?.summaryModel;
      const tierId = isTierRef(summaryModel) ? parseTierRef(summaryModel) : null;
      if (tierId) tierIds.add(tierId);
    } catch {
      // Malformed settings cannot contain a usable tier reference.
    }
  }

  return [...tierIds];
}

/**
 * Repair every persisted consumer of any tier that no longer resolves to an
 * executable member (a tier "emptied" by provider deletion, model removal, or
 * a member-model rename), plus any consumer still pointing at a tier that does
 * not exist at all. The tier rows themselves are KEPT (PRD §7 S7 / §8 E2: an
 * emptied tier stops appearing in selectors until repopulated) — only the
 * dangling references are cleared, so new/automated session creation and the
 * other consumers fall back to their default model instead of failing tier
 * validation.
 *
 * Runs atomically. Idempotent: already-repaired (or never-referenced) tiers
 * are untouched. Designed to be called in the same transaction as the
 * mutation that emptied the tier — better-sqlite3 nests transactions via
 * savepoints, so embedding this in an outer transaction keeps the whole
 * removal + repair atomic.
 *
 * @returns {string[]} Ids of the tiers whose references were degraded.
 */
export function degradeReferencesToEmptiedTiers() {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const now = Date.now();
    const degraded = [];

    for (const tierId of findReferencedTierIds(db)) {
      if (hasExecutableMember(db, tierId)) continue;
      // A tier with no executable member can never contribute an active
      // fallback, so the references are cleared to the per-surface defaults.
      degradeTierReferences(db, buildTierRef(tierId), null, now);
      degraded.push(tierId);
    }

    return degraded;
  });
}

/**
 * Delete a tier and atomically degrade every forward-looking persisted tier
 * reference. No reader can observe the tier gone while any configuration
 * still points to its sentinel.
 *
 * When an active member exists, forward-looking references become that
 * concrete member (and the paired provider field is persisted where the
 * schema has one). Existing sessions instead keep their own last-resolved
 * concrete member when they have one. When neither a per-session snapshot nor
 * an active member exists, the selection is cleared, which is the product's
 * existing "use the configured/default model" behavior for each surface.
 *
 * @param {string} tierId
 * @returns {{ fallback: { providerId: string, modelId: string } | null } | null}
 *   null when the tier was already absent.
 */
export function deleteTierAndDegradeReferences(tierId) {
  return databaseManager.transaction(() => {
    const db = databaseManager.get();
    const tier = db.prepare('SELECT id FROM model_tiers WHERE id = ?').get(tierId);
    if (!tier) return null;

    const tierRef = buildTierRef(tierId);
    const fallback = getActiveFallbackMember(db, tierId);
    degradeTierReferences(db, tierRef, fallback, Date.now());
    db.prepare('DELETE FROM model_tiers WHERE id = ?').run(tierId);

    return {
      fallback: fallback
        ? { providerId: fallback.providerId, modelId: fallback.modelId }
        : null,
    };
  });
}
