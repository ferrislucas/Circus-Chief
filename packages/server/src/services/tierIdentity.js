import { modelProviders } from '../database.js';
import { isTierRef } from '@circuschief/shared';

/**
 * Typed identity failures for an exact `{ providerId, modelId }` pair.
 *
 * A tier member is ONE atomic identity: both halves must validate against the
 * CURRENT catalog. A stale pair must never be "repaired" by matching only the
 * model id against a different provider, and must never fall back to SDK or
 * server defaults — callers fail with one of these codes and an actionable
 * message instead.
 */
export const TIER_IDENTITY_ERROR_CODES = Object.freeze({
  PROVIDER_MISSING: 'provider_missing',
  PROVIDER_DISABLED: 'provider_disabled',
  MODEL_MISSING: 'model_missing',
  MODEL_DISABLED: 'model_disabled',
});

export class TierIdentityError extends Error {
  constructor({ code, providerId, modelId, detail }) {
    super(detail || `Tier member ${providerId}/${modelId} is not usable (${code})`);
    this.name = 'TierIdentityError';
    this.code = code;
    this.providerId = providerId ?? null;
    this.modelId = modelId ?? null;
  }
}

/**
 * Describe why an exact provider/model pair is unusable, or null when it is
 * fully executable (provider exists and is enabled; the provider owns an
 * enabled, non-removed row for the model id).
 *
 * Executability is decided by `enabled` alone. There is no `unavailable`
 * column on provider_models and no server writer for such a flag — it
 * exists only as a web display-layer marking (ModelSelector's
 * preserved-but-disabled models) and must never gate server-side identity.
 *
 * @param {string|null} providerId
 * @param {string|null} modelId
 * @returns {string|null} One of TIER_IDENTITY_ERROR_CODES, or null when valid.
 */
export function describeIdentityProblem(providerId, modelId) {
  if (!providerId || !modelId) return TIER_IDENTITY_ERROR_CODES.MODEL_MISSING;
  const provider = modelProviders.getById(providerId);
  if (!provider) return TIER_IDENTITY_ERROR_CODES.PROVIDER_MISSING;
  if (provider.enabled === false) return TIER_IDENTITY_ERROR_CODES.PROVIDER_DISABLED;
  const model = provider.models?.find((entry) => entry.modelId === modelId);
  if (!model) return TIER_IDENTITY_ERROR_CODES.MODEL_MISSING;
  if (model.enabled === false) {
    return TIER_IDENTITY_ERROR_CODES.MODEL_DISABLED;
  }
  return null;
}

/**
 * Validate an exact `{ providerId, modelId }` identity against the current
 * catalog. Returns the pair unchanged when valid; throws a typed
 * {@link TierIdentityError} with an actionable message otherwise.
 *
 * @param {string} providerId
 * @param {string} modelId
 * @returns {{ providerId: string, modelId: string }}
 * @throws {TierIdentityError}
 */
export function validateExactTierMember(providerId, modelId) {
  const code = describeIdentityProblem(providerId, modelId);
  if (!code) return { providerId, modelId };
  throw new TierIdentityError({
    code,
    providerId,
    modelId,
    detail: identityErrorDetail(code, providerId, modelId),
  });
}

/**
 * Non-throwing form of {@link validateExactTierMember}.
 *
 * @param {string|null} providerId
 * @param {string|null} modelId
 * @returns {boolean}
 */
export function isExactTierMemberValid(providerId, modelId) {
  return describeIdentityProblem(providerId, modelId) === null;
}

/**
 * Fail-closed guard for the standard start path: a `tier::` reference must
 * be resolved to a concrete member (via `_runTierBoundSession`) before
 * standard provider resolution. Throws a {@link TierIdentityError} when a
 * sentinel leaks through instead of letting it fall through to null/
 * SDK-default resolution, provider dispatch, or `lastExecutedModel`.
 *
 * @param {string|null} effectiveModel
 * @param {string|null} [providerId]
 * @throws {TierIdentityError}
 */
export function assertConcreteStartModel(effectiveModel, providerId = null) {
  if (!isTierRef(effectiveModel)) return;
  throw new TierIdentityError({
    code: TIER_IDENTITY_ERROR_CODES.MODEL_MISSING,
    providerId,
    modelId: effectiveModel,
    detail: `Tier reference "${effectiveModel}" reached the standard start path; resolve it to a concrete tier member first.`,
  });
}

function identityErrorDetail(code, providerId, modelId) {
  switch (code) {
    case TIER_IDENTITY_ERROR_CODES.PROVIDER_MISSING:
      return (
        `Tier member "${modelId}" is pinned to provider "${providerId}", which no longer exists. ` +
        `The conversation cannot continue on that member; select a current member explicitly.`
      );
    case TIER_IDENTITY_ERROR_CODES.PROVIDER_DISABLED:
      return (
        `Tier member "${modelId}" is pinned to provider "${providerId}", which is currently disabled. ` +
        `Re-enable the provider or select a current member explicitly.`
      );
    case TIER_IDENTITY_ERROR_CODES.MODEL_DISABLED:
      return (
        `Tier member "${modelId}" on provider "${providerId}" is currently disabled. ` +
        `Re-enable the model or select a current member explicitly.`
      );
    default:
      return (
        `Tier member "${modelId}" on provider "${providerId}" no longer exists in the catalog. ` +
        `Select a current member explicitly.`
      );
  }
}
