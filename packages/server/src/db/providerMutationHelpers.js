/**
 * providerMutationHelpers.js — pure validation/column helpers for provider and
 * provider-model mutations.
 *
 * Extracted from ProviderRepository.js so the repository stays within its
 * size budget. No database access here: every helper is a pure function of
 * its inputs, which keeps the transactional degradation pipeline (which lives
 * next to the repository boundary) easy to reason about.
 */

import { encrypt } from '../services/encryption.js';
import { normalizeCommitAttributionOverride } from '@circuschief/shared/contracts/providers';

const BUILT_IN_MUTABLE_FIELDS = Object.freeze(['commitAttributionOverride', 'enabled']);

const UPDATE_COLUMN_BUILDERS = Object.freeze({
  name: (value) => ['name = ?', value],
  baseUrl: (value) => ['base_url = ?', value],
  authToken: (value) => ['auth_token = ?', encrypt(value)],
  apiTimeoutMs: (value) => ['api_timeout_ms = ?', value],
  additionalEnvVars: (value) => [
    'additional_env_vars = ?',
    value ? JSON.stringify(value) : null,
  ],
  commitAttributionOverride: (value) => [
    'commit_attribution_override = ?',
    normalizeCommitAttributionOverride(value),
  ],
  enabled: (value) => ['enabled = ?', value ? 1 : 0],
});

export function validateBuiltInUpdate(provider, data) {
  if (!provider.isBuiltIn) return;

  const unsupportedFields = Object.keys(data || {}).filter(
    (key) => !BUILT_IN_MUTABLE_FIELDS.includes(key)
  );
  if (unsupportedFields.length > 0) {
    throw new Error(
      `Built-in providers can only update: ${BUILT_IN_MUTABLE_FIELDS.join(', ')}. Rejected fields: ${unsupportedFields.join(', ')}.`
    );
  }
}

export function validateKindImmutable(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'kind')) return;

  throw new Error(
    "Provider kind is immutable after create. Delete and recreate the provider to change kind."
  );
}

export function buildUpdateColumns(data = {}) {
  return Object.entries(UPDATE_COLUMN_BUILDERS).reduce((result, [field, buildColumn]) => {
    if (data[field] === undefined) return result;

    const [update, value] = buildColumn(data[field]);
    result.updates.push(update);
    result.values.push(value);
    return result;
  }, { updates: [], values: [] });
}

/**
 * A mutation can make a previously executable tier member ineligible. Keep
 * this decision next to the repository boundary so delete, rename, and
 * disable all use the same transactional degradation pipeline.
 */
export function removesProviderEligibility(provider, data) {
  return data.enabled === false && provider.enabled !== false;
}

export function removesModelEligibility(model, data) {
  return (
    (data.modelId !== undefined && data.modelId !== model.modelId) ||
    (data.enabled === false && model.enabled !== false)
  );
}
