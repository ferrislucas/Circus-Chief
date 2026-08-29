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
 * Resolve the cooldown duration to apply. An explicit `cooldownMs` argument
 * always wins; otherwise honors `E2E_TIER_COOLDOWN_MS` (test-only — lets the
 * Playwright failover suite exercise cooldown-skip and cooldown-expiry
 * deterministically with a short, real cooldown instead of the 5-minute
 * production default or a fixed sleep — see
 * model-tiers-e2e-coverage-plan.md Phase 0/1); falls back to the shared
 * production default.
 * @param {number|undefined} explicitCooldownMs
 * @returns {number}
 */
function resolveCooldownMs(explicitCooldownMs) {
  if (explicitCooldownMs !== undefined) return explicitCooldownMs;
  const override = process.env.E2E_TIER_COOLDOWN_MS;
  if (override !== undefined && override !== '') {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_TIER_COOLDOWN_MS;
}

/**
 * Mark a (provider, model) pair as unhealthy for the cooldown period.
 * @param {string} providerId
 * @param {string} modelId
 * @param {number} [cooldownMs]
 */
export function markUnhealthy(providerId, modelId, cooldownMs) {
  cooldownMap.set(cooldownKey(providerId, modelId), Date.now() + resolveCooldownMs(cooldownMs));
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
 * exists or is disabled, and members whose specific model was removed from an
 * otherwise-still-present provider (Issue 3 — `model_tier_members.model_id` has
 * no FK, so a deleted model would otherwise leave an orphaned, unresolvable
 * member). Ordered by position.
 * @param {string} tierId
 * @returns {Array<{ providerId: string, modelId: string, position: number }>}
 */
export function getTierMembersResolved(tierId) {
  const tier = modelTiers.getByIdWithMembers(tierId);
  if (!tier) return [];

  return tier.members
    .filter((m) => {
      const provider = modelProviders.getById(m.providerId);
      if (!provider || provider.enabled === false) return false;
      // Reuse the already-fetched provider object — no extra query per member.
      return provider.models.some((model) => model.modelId === m.modelId);
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
 * Resolve the first configured member of a tier without consulting cooldown.
 *
 * Cooldown is a scheduling hint for choosing a new-session attempt; it must
 * not make an existing binding unusable or prevent structural agent-kind
 * checks. Missing, empty, and otherwise invalid tiers still return `null`.
 *
 * @param {string|null|undefined} modelOrRef
 * @param {{ providerId?: string|null }} [context]
 * @returns {{ model: string, providerId: string|null } | null}
 */
export function resolveAnyMember(modelOrRef, context = {}) {
  if (!isTierRef(modelOrRef)) {
    return { model: modelOrRef, providerId: context.providerId ?? null };
  }

  const tierId = parseTierRef(modelOrRef);
  if (!tierId) return null;
  const [member] = getTierMembersResolved(tierId);
  return member ? { model: member.modelId, providerId: member.providerId } : null;
}

/**
 * Find the single next tier member that would actually be attempted after
 * `failedMember`, for both (a) the failover-vs-terminal decision and (b) the
 * failover notice/log payload — one ordered scan shared by both so they can
 * never disagree (Fix 5).
 *
 * A pure forward-only, cooldown-aware scan: only considers members strictly
 * AFTER `failedMember`'s position and skips members currently in cooldown.
 * The tier is exhausted before failure — there is no attempt cap. The loop
 * that calls this (`runSessionWithTierFailover`) iterates a finite,
 * DB-ordered, de-duplicated member list with no re-entry path that could
 * revisit a member, so `members.length` is itself the termination bound.
 *
 * @param {string} tierRef - Tier ref sentinel string.
 * @param {{ modelId: string, providerId: string }} failedMember - The member that just failed.
 * @returns {{ providerId: string, modelId: string, position: number }|null}
 */
export function findNextHealthyTierMember(tierRef, failedMember) {
  const tierId = parseTierRef(tierRef);
  if (!tierId) return null;

  const members = getTierMembersResolved(tierId);
  const failedIndex = members.findIndex(
    (m) => m.providerId === failedMember.providerId && m.modelId === failedMember.modelId
  );
  if (failedIndex === -1) return null;

  for (let i = failedIndex + 1; i < members.length; i++) {
    const candidate = members[i];
    if (!isUnhealthy(candidate.providerId, candidate.modelId)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Snapshot-reuse result for a tier-bound session (PRD E3/D6): the concrete
 * member pair captured for THIS same binding. Used both when no explicit model
 * is requested and when the explicit request re-selects the already-bound tier
 * (the web client echoes session.model; the scheduled auto-send consumes
 * pendingModel) — so a binding whose tier went stale after creation still
 * continues on its last active concrete member, and `modelChanged` stays
 * false, preserving resume/context state.
 *
 * @param {Object} session - Current session row (resolvedModel, resolvedProviderId).
 * @returns {{ effectiveModel: string, providerIdHint: string, persist: Object }|null}
 */
function snapshotResolution(session) {
  if (!session.resolvedModel) return null;
  return {
    effectiveModel: session.resolvedModel,
    providerIdHint: session.resolvedProviderId || null,
    persist: {},
  };
}

/**
 * Resolve an explicit tier-ref request (`resolveTierRefForContinue` branch).
 * Switching tiers must never reuse a snapshot captured for a different,
 * previously-bound tier — the NEW tier is resolved live. Re-selecting the
 * ALREADY-bound tier reuses that binding's own snapshot (see
 * `snapshotResolution`).
 *
 * @param {Object} session - Current session row.
 * @param {string} requestedModel - The explicit `tier::<id>` request.
 * @returns {{ effectiveModel: string, providerIdHint: string, persist: Object }}
 * @throws {Error} when the requested tier has no enabled configured members.
 */
function resolveRequestedTierRef(session, requestedModel) {
  if (requestedModel === session.model) {
    const snapshot = snapshotResolution(session);
    if (snapshot) return snapshot;
  }

  const resolved = resolveAnyMember(requestedModel, {});
  if (!resolved) {
    throw new Error(
      `Tier "${requestedModel}" has no enabled configured members — cannot continue session`
    );
  }
  return {
    effectiveModel: resolved.model,
    providerIdHint: resolved.providerId,
    persist: { model: requestedModel, resolvedModel: resolved.model, resolvedProviderId: resolved.providerId },
  };
}

/**
 * Resolve the concrete (model, providerId) to use for a continuation-style
 * call (`continueSessionCore`, `continueSessionWithExistingMessage`), given
 * the session's stored binding and an optional explicit request from the
 * caller (Fix 2).
 *
 * A single, provider-aware resolver shared by both continuation paths so:
 *   - an explicit tier-ref request (switching tiers mid-conversation, or via
 *     the live picker) is always resolved LIVE against that requested tier —
 *     never against a snapshot captured for a *different*, previously-bound
 *     tier — and is never forwarded to an adapter as a raw `tier::<id>` value;
 *   - an explicit concrete-model request always clears any previously stored
 *     tier snapshot (`resolvedModel` / `resolvedProviderId`), since the
 *     session is no longer tier-bound;
 *   - a session with no explicit request reuses its own stored snapshot when
 *     present, or re-resolves live and backfills the snapshot when absent
 *     (e.g. a legacy row created before snapshots existed).
 *
 * @param {Object} session - Current session row (model, resolvedModel, resolvedProviderId).
 * @param {string|null} [requestedModel] - Explicit model override from the caller, or null/undefined to keep the current binding.
 * @returns {{
 *   effectiveModel: string|null,
 *   providerIdHint: string|null,
 *   persist: { model?: string|null, resolvedModel?: string|null, resolvedProviderId?: string|null }
 * }}
 */
export function resolveTierRefForContinue(session, requestedModel) {
  // Explicit concrete-model override: always wins, always clears any tier snapshot.
  if (requestedModel && !isTierRef(requestedModel)) {
    return {
      effectiveModel: requestedModel,
      providerIdHint: null,
      persist: { model: requestedModel, resolvedModel: null, resolvedProviderId: null },
    };
  }

  // Explicit tier-ref override — see resolveRequestedTierRef for semantics.
  if (requestedModel && isTierRef(requestedModel)) {
    return resolveRequestedTierRef(session, requestedModel);
  }

  // No explicit override — use whatever is already bound to the session.
  if (isTierRef(session.model)) {
    // Reuse the snapshot — it was captured for THIS same tier binding.
    const snapshot = snapshotResolution(session);
    if (snapshot) return snapshot;

    // Snapshot missing (e.g. a legacy row) — resolve structurally and backfill
    // it. Continuation is not a new-session scheduling decision, so cooldown
    // must not block the already-bound session.
    const live = resolveAnyMember(session.model, {});
    if (!live) {
      throw new Error(
        `Tier "${session.model}" has no enabled configured members available to continue the session`
      );
    }
    return {
      effectiveModel: live.model,
      providerIdHint: live.providerId,
      persist: { resolvedModel: live.model, resolvedProviderId: live.providerId },
    };
  }

  // Plain concrete session, nothing requested — passthrough, no persistence.
  return { effectiveModel: session.model, providerIdHint: null, persist: {} };
}
