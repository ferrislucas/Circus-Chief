import { modelProviders } from '../database.js';
import { MODEL_TIER_ALIASES } from '../db/ProviderRepository.js';

/**
 * Validate a requested model id against the live provider model registry plus
 * SDK tier aliases.
 *
 * @param {*} value - The requested model id
 * @param {{ allowNull?: boolean, fieldName?: string }} [options]
 * @returns {{ error?: string, value?: * }}
 */
export function validateModelId(value, { allowNull = true, fieldName = 'model' } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return { value: value === undefined ? value : null };
    return { error: `${fieldName} is required` };
  }

  if (typeof value !== 'string') {
    return { error: `${fieldName} must be a string or null` };
  }

  if (value === '') {
    return { value };
  }

  const validIds = modelProviders.getAllModelIds();

  if (MODEL_TIER_ALIASES.includes(value.toLowerCase())) {
    return { value };
  }

  if (validIds.includes(value)) {
    return { value };
  }

  return {
    error: `Invalid ${fieldName} id "${value}". Valid model ids are: ${validIds.join(', ')}`,
  };
}
