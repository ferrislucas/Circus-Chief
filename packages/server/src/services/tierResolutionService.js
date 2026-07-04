import { isTierRef, parseTierRef, DEFAULT_TIER_COOLDOWN_MS } from '@circuschief/shared';
import { modelTiers, modelProviders } from '../database.js';

/**
 * In-memory cooldown store. Maps "providerId::modelId" → expiry timestamp (ms).
 *
 * Scope note (Fix 6 / E7): this map is per-process. Cooldown entries are cleared
 * on server restart, meaning a member that failed before a restart is immediately
 * retryable again. For a local-first, single-process deployment this is acceptable:
 * the thundering-herd protection (F21) is effective within a session's lifecycle.
 * If multi-process or multi-replica deployments are ever added, cooldown state
 * should be persisted (e.g., a `healthy_until` column in the provider_models table
 * or a shared store) so the protection spans process boundaries.
 *
 * @type {Map<string, number>}
 */
const cooldownMap = new Map();

function cooldownKey(providerId, modelId) {
  return `${providerId}::${modelId}`;
}

/**
 * Sweep expired entries from the cooldown map (called on every read).
 */
function sweepExpired() {
  const now = Date.now();
  for (const [key, expiry] of cooldownMap) {
    if (now >= expiry) cooldownMap.delete(key);
  }
}

/**
 * Mark a (provider, model) pair as unhealthy for the cooldown period.
 * @param {string} providerId
 * @param {string} modelId
 * @param {number} [cooldownMs]
 */
export function markUnhealthy(providerId, modelId, cooldownMs = DEFAULT_TIER_COOLDOWN_MS) {
  cooldownMap.set(cooldownKey(providerId, modelId), Date.now() + cooldownMs);
}

/**
 * Check whether a (provider, model) pair is currently in cooldown.
 * @param {string} providerId
 * @param {string} modelId
 * @returns {boolean}
 */
export function isUnhealthy(providerId, modelId) {
  sweepExpired();
  const expiry = cooldownMap.get(cooldownKey(providerId, modelId));
  return expiry !== undefined && Date.now() < expiry;
}

/**
 * Clear cooldown for a (provider, model) pair.
 * @param {string} providerId
 * @param {string} modelId
 */
export function clearUnhealthy(providerId, modelId) {
  cooldownMap.delete(cooldownKey(providerId, modelId));
}

/**
 * Get tier members for a tier, filtering out members whose provider no longer
 * exists and ordering by position.
 * @param {string} tierId
 * @returns {Array<{ providerId: string, modelId: string, position: number }>}
 */
export function getTierMembersResolved(tierId) {
  const tier = modelTiers.getByIdWithMembers(tierId);
  if (!tier) return [];

  return tier.members
    .filter((m) => {
      const provider = modelProviders.getById(m.providerId);
      return provider && provider.enabled !== false;
    })
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/**
 * Resolve the active (model, providerId) for a model string or tier ref.
 *
 * - If `modelOrRef` is NOT a tier ref → passthrough. Returns `{ model, providerId }` unchanged.
 * - If it IS a tier ref → resolve the tier, skip unhealthy members, return first healthy.
 * - If all members are exhausted (cooldown or deleted) → returns `null`.
 *
 * @param {string|null|undefined} modelOrRef - Session model field (may be a tier ref)
 * @param {{ providerId?: string|null }} [context] - Current session context
 * @returns {{ model: string, providerId: string|null } | null}
 */
export function resolveActiveModel(modelOrRef, context = {}) {
  if (!isTierRef(modelOrRef)) {
    // Plain model — passthrough
    return { model: modelOrRef, providerId: context.providerId ?? null };
  }

  const tierId = parseTierRef(modelOrRef);
  if (!tierId) return null;

  const members = getTierMembersResolved(tierId);
  if (members.length === 0) return null;

  for (const member of members) {
    if (!isUnhealthy(member.providerId, member.modelId)) {
      return { model: member.modelId, providerId: member.providerId };
    }
  }

  return null; // All members are in cooldown
}

/**
 * Check whether there is a healthy member available after excluding a specific
 * (providerId, modelId) pair. Used by the failover decision logic to determine
 * whether to advance to the next member.
 *
 * @param {string} tierRef - Tier ref sentinel string
 * @param {{ excludeModelId: string, excludeProviderId: string }} opts
 * @returns {boolean}
 */
export function hasNextHealthyMember(tierRef, { excludeModelId, excludeProviderId }) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) return false;

  const members = getTierMembersResolved(tierId);
  return members.some(
    (m) =>
      !(m.providerId === excludeProviderId && m.modelId === excludeModelId) &&
      !isUnhealthy(m.providerId, m.modelId)
  );
}
