import { modelProviders } from '../database.js';
import { MODEL_TIER_ALIASES } from '../db/ProviderRepository.js';

/**
 * Validate a requested model id against the live set of valid model ids
 * (the `provider_models` table unioned with the SDK tier aliases).
 *
 * Mirrors how the resolver (`getProviderByModelId`) interprets ids: tier
 * aliases match case-insensitively, everything else must be an exact match
 * against a registered `provider_models` id. The provider `enabled` flag is
 * ignored (same as the resolver).
 *
 * @param {*} value - The requested model id
 * @param {{ allowNull?: boolean }} [options]
 * @returns {{ error?: string, value?: * }}
 *   `{ value }` on success; `{ error }` (suitable for a 400) on failure.
 */
export function validateModelId(value, { allowNull = true } = {}) {
  // null / undefined → "clear" / "use default"
  if (value === null || value === undefined) {
    if (allowNull) return { value: value === undefined ? value : null };
    return { error: 'model is required' };
  }

  if (typeof value !== 'string') {
    return { error: 'model must be a string or null' };
  }

  // Empty string → treated as "not provided"; falls back to default.
  if (value === '') {
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
    error: `Invalid model id "${value}". Valid model ids are: ${validIds.join(', ')}`,
  };
}
