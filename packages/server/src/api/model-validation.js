import { modelProviders } from '../database.js';
import { MODEL_TIER_ALIASES } from '../db/ProviderRepository.js';
import { isTierRef, parseTierRef } from '@circuschief/shared';
import { getTierMembersResolved } from '../services/tierResolutionService.js';

/**
 * Validate a requested model id against the live set of valid model ids
 * (the `provider_models` table unioned with the SDK tier aliases), OR a
 * Model Tier reference sentinel (`tier::<id>`).
 *
 * Mirrors how the resolver (`getProviderByModelId`) interprets ids: tier
 * aliases match case-insensitively, everything else must be an exact match
 * against a registered `provider_models` id. The provider `enabled` flag is
 * ignored (same as the resolver).
 *
 * A `tier::<id>` value is accepted only when it is well-formed (has a
 * non-empty id) AND currently resolves to at least one enabled tier member —
 * this is the write-time check called for by the Model Tiers remediation
 * plan (Work Item 1). An empty/malformed/unknown/emptied tier ref is
 * rejected with a 400-style error so a broken binding is never persisted.
 *
 * @param {*} value - The requested model id
 * @param {{ allowNull?: boolean, fieldName?: string }} [options]
 * @returns {{ error?: string, value?: * }}
 *   `{ value }` on success; `{ error }` (suitable for a 400) on failure.
 */
export function validateModelId(value, { allowNull = true, fieldName = 'model' } = {}) {
  // null / undefined → "clear" / "use default"
  if (value === null || value === undefined) {
    if (allowNull) return { value: value === undefined ? value : null };
    return { error: `${fieldName} is required` };
  }

  if (typeof value !== 'string') {
    return { error: `${fieldName} must be a string or null` };
  }

  // Empty string → treated as "not provided"; falls back to default.
  if (value === '') {
    return { value };
  }

  // Model Tier reference sentinel — validate separately from concrete model ids.
  if (isTierRef(value)) {
    const tierId = parseTierRef(value);
    if (!tierId) {
      return { error: `Invalid ${fieldName}: malformed tier reference "${value}"` };
    }
    const members = getTierMembersResolved(tierId);
    if (members.length === 0) {
      return {
        error: `Invalid ${fieldName}: tier "${tierId}" does not exist or has no enabled members`,
      };
    }
    return { value };
  }

  const validIds = modelProviders.getAllModelIds();

  // Tier aliases match case-insensitively (mirrors the resolver).
  if (MODEL_TIER_ALIASES.includes(value.toLowerCase())) {
    return { value };
  }

  // Everything else must be an exact match against a registered model id.
  if (validIds.includes(value)) {
    return { value };
  }

  return {
    error: `Invalid ${fieldName} id "${value}". Valid model ids are: ${validIds.join(', ')}`,
  };
}

/**
 * Validate a (model, providerId) pair together: runs {@link validateModelId}
 * on `model`, then — when `model` is a tier reference — normalizes/validates
 * the companion `providerId` field to `null` (Work Item 1). A tier binding
 * has no single owning provider; the concrete provider is determined per-run
 * by the active tier member, so a stray concrete `providerId` alongside a
 * tier ref would be stale/misleading and must be cleared.
 *
 * Non-tier values pass `providerId` through unchanged (existing per-field
 * validation, if any, still applies at the call site).
 *
 * @param {*} model
 * @param {*} providerId
 * @param {{ allowNull?: boolean, fieldName?: string }} [options]
 * @returns {{ error?: string, model?: *, providerId?: * }}
 */
export function validateModelAndProvider(model, providerId, options = {}) {
  const modelResult = validateModelId(model, options);
  if (modelResult.error) return { error: modelResult.error };

  if (isTierRef(modelResult.value)) {
    if (providerId !== null && providerId !== undefined) {
      return { error: 'providerId must be null when model is a tier reference' };
    }
    return { model: modelResult.value, providerId: null };
  }

  return { model: modelResult.value, providerId };
}

/**
 * Validate a Model Tier's member list at write time (create/update) — Work
 * Item 3. A member is valid when its provider exists AND owns a
 * non-removed `provider_models` row for that `modelId`, mirroring
 * `getTierMembersResolved`'s ownership filter.
 *
 * Deliberately NOT checked here (both are runtime-resolution concerns, not
 * write-time validity — see the Model Tier Review Remediation Plan, Work
 * Item 3):
 *   - Model-level `enabled` — `getModels` returns non-removed models
 *     regardless of `enabled`, and tier resolution never checks it either.
 *   - Provider-level `enabled` — rejecting a disabled provider's models at
 *     write time would make an unrelated tier uneditable whenever a user
 *     temporarily disables a provider.
 *
 * The member list is validated atomically: the first invalid pair fails the
 * whole request, so a tier is never partially persisted with a mix of valid
 * and invalid members.
 *
 * @param {Array<{providerId: string, modelId: string}>} members
 * @returns {{ error?: string, value?: Array }}
 */
export function validateTierMembers(members) {
  if (!Array.isArray(members)) {
    return { error: 'members must be an array' };
  }

  for (const member of members) {
    const provider = modelProviders.getById(member.providerId);
    if (!provider) {
      return { error: `Invalid tier member: unknown provider "${member.providerId}"` };
    }
    const ownsModel = provider.models?.some((model) => model.modelId === member.modelId);
    if (!ownsModel) {
      return {
        error: `Invalid tier member: provider "${member.providerId}" does not own model "${member.modelId}"`,
      };
    }
  }

  return { value: members };
}
