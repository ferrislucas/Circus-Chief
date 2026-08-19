import { modelProviders } from '../database.js';

/**
 * Validate a requested model id against the live set of valid model ids
 * (the `provider_models` table).
 *
 * Everything must be an exact match against a registered `provider_models`
 * id. The provider `enabled` flag is ignored (same as the resolver).
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

  const validIds = modelProviders.getAllModelIds();

  // Must be an exact match against a registered model id.
  if (validIds.includes(value)) {
    return { value };
  }

  return {
    error: `Invalid ${fieldName} id "${value}". Valid model ids are: ${validIds.join(', ')}`,
  };
}
