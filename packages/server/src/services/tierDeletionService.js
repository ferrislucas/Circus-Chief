import { databaseManager } from '../db/DatabaseManager.js';
import { buildTierRef } from '@circuschief/shared';

const SUMMARY_SETTINGS_KEY = 'summary_settings';
const SUMMARY_PROVIDER_KINDS = new Set(['anthropic', 'openai']);

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

  // Summary calls only support Anthropic and OpenAI. A valid summary tier is
  // already constrained to those kinds, but clearing is safer for legacy/raw
  // data than persisting a concrete model the summary client cannot route.
  const canUseFallback = fallback && SUMMARY_PROVIDER_KINDS.has(fallback.providerKind);
  parsed.summaryModel = canUseFallback ? fallback.modelId : '';
  parsed.summaryProviderId = canUseFallback ? fallback.providerId : null;
  db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
    .run(JSON.stringify(parsed), now, SUMMARY_SETTINGS_KEY);
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
    const fallbackModel = fallback?.modelId ?? null;
    const fallbackProviderId = fallback?.providerId ?? null;
    const now = Date.now();

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
    // Pin it to its own last-resolved concrete model so deleting the tier does
    // not silently move an established conversation back to another provider.
    // SQLite evaluates every RHS against the pre-update row, so the snapshot
    // can be consumed and then cleared atomically as the tier ref becomes a
    // concrete binding.
    db.prepare(
      `UPDATE sessions
       SET model = COALESCE(resolved_model, ?),
           provider_id = CASE
             WHEN resolved_model IS NOT NULL THEN resolved_provider_id
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
    db.prepare('DELETE FROM model_tiers WHERE id = ?').run(tierId);

    return {
      fallback: fallback
        ? { providerId: fallback.providerId, modelId: fallback.modelId }
        : null,
    };
  });
}
