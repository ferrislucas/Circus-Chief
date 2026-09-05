import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { normalizeCommitAttributionOverride } from '@circuschief/shared/contracts/providers';
import * as modelOps from './providerModelOperations.js';

/**
 * Valid values for `providers.kind`. Maps 1:1 to an agent adapter:
 *   - 'anthropic' ��� 'claude-code'
 *   - 'openai'    → 'codex'
 *   - 'google'    → 'gemini'
 */
export const PROVIDER_KINDS = Object.freeze(['anthropic', 'openai', 'google']);

/**
 * Model tier aliases handled directly by the Claude SDK. These are matched
 * case-insensitively and are always considered valid model ids in addition to
 * whatever lives in the `provider_models` table.
 */
export const MODEL_TIER_ALIASES = Object.freeze(['fable', 'opus', 'sonnet', 'haiku']);

/**
 * Mapping from provider kind to the agent adapter that should drive sessions
 * backed by that provider.
 */
export const AGENT_TYPE_BY_KIND = Object.freeze({
  anthropic: 'claude-code',
  openai: 'codex',
  google: 'gemini',
});

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

function validateBuiltInUpdate(provider, data) {
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

function validateKindImmutable(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'kind')) return;

  throw new Error(
    "Provider kind is immutable after create. Delete and recreate the provider to change kind."
  );
}

function buildUpdateColumns(data = {}) {
  return Object.entries(UPDATE_COLUMN_BUILDERS).reduce((result, [field, buildColumn]) => {
    if (data[field] === undefined) return result;

    const [update, value] = buildColumn(data[field]);
    result.updates.push(update);
    result.values.push(value);
    return result;
  }, { updates: [], values: [] });
}

/**
 * Provider repository class (replaces ModelProviderRepository).
 *
 * Key differences from the old ModelProviderRepository:
 * - Uses `providers` table (renamed from `model_providers`)
 * - No `default_opus_model` / `default_sonnet_model` / `default_haiku_model` columns
 * - No auto-sync logic (#syncDefaultModels removed)
 * - Auth tokens are encrypted at rest (AES-256-GCM via encryption service)
 * - `getProviderByModelId` includes models (needed for buildProviderEnv)
 * - Providers carry a `kind` (`'anthropic'` | `'openai'`) that selects the
 *   agent adapter and env-var convention. `kind` is **immutable** after create.
 */
export class ProviderRepository extends BaseRepository {
  constructor() {
    super('providers', ProviderRepository.#mapProvider);
  }

  static #mapProvider(row) {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      // Decrypt the stored auth token transparently (handles legacy plaintext gracefully)
      authToken: decrypt(row.auth_token),
      apiTimeoutMs: row.api_timeout_ms,
      additionalEnvVars: row.additional_env_vars ? JSON.parse(row.additional_env_vars) : null,
      commitAttributionOverride: row.commit_attribution_override ?? null,
      isBuiltIn: row.is_built_in === 1,
      enabled: row.enabled === 1,
      kind: row.kind || 'anthropic',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new provider
   * @param {Object} data - Provider data
   * @param {string} data.name
   * @param {string|null} [data.baseUrl]
   * @param {string|null} [data.authToken]
   * @param {number|null} [data.apiTimeoutMs]
   * @param {Object|null} [data.additionalEnvVars]
   * @returns {Object} Created provider (with models array)
   */
  create(data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    const {
      name,
      baseUrl = null,
      authToken = null,
      apiTimeoutMs = null,
      additionalEnvVars = null,
      commitAttributionOverride = null,
      kind = 'anthropic',
    } = data;

    // Application-layer validation: give a clear error ahead of the DB CHECK.
    if (!PROVIDER_KINDS.includes(kind)) {
      throw new Error(
        `Invalid provider kind "${kind}". Must be one of: ${PROVIDER_KINDS.join(', ')}.`
      );
    }

    this.db
      .prepare(
        `INSERT INTO providers (id, name, base_url, auth_token, api_timeout_ms, additional_env_vars, commit_attribution_override, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        baseUrl,
        encrypt(authToken),
        apiTimeoutMs,
        additionalEnvVars ? JSON.stringify(additionalEnvVars) : null,
        normalizeCommitAttributionOverride(commitAttributionOverride),
        kind,
        now,
        now
      );

    return this.getById(id);
  }

  /**
   * Get all providers (always includes models)
   * @returns {Array<Object>}
   */
  getAll() {
    const rows = this.db.prepare('SELECT * FROM providers ORDER BY is_built_in DESC, name ASC').all();
    return this.mapAll(rows).map(provider => ({
      ...provider,
      models: this.getModels(provider.id),
    }));
  }

  /**
   * Return the small provider shape needed by allowance snapshots.
   * Unlike getAll(), this deliberately avoids one model query per provider.
   * @returns {Array<Object>}
   */
  getEnabledForAllowances() {
    const rows = this.db
      .prepare('SELECT * FROM providers WHERE enabled = 1 ORDER BY is_built_in DESC, name ASC')
      .all();
    return this.mapAll(rows);
  }

  /**
   * Get a provider by ID (always includes models)
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    const provider = super.getById(id);
    if (!provider) return null;
    return { ...provider, models: this.getModels(id) };
  }

  /**
   * Update a provider
   * @param {string} id
   * @param {Object} data
   * @returns {Object} Updated provider (with models array)
   */
  update(id, data) {
    const provider = this.getById(id);
    if (!provider) return null;

    validateBuiltInUpdate(provider, data);
    validateKindImmutable(data);

    const { updates, values } = buildUpdateColumns(data);

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);

      this.db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getById(id);
  }

  /**
   * Delete a provider (prevents deletion of built-in providers)
   * @param {string} id
   * @throws {Error} If attempting to delete a built-in provider or non-existent provider
   */
  delete(id) {
    const provider = this.getById(id);
    if (!provider) {
      throw new Error('Provider not found');
    }
    if (provider.isBuiltIn) {
      throw new Error('Cannot delete built-in provider');
    }

    super.delete(id);
  }

  /**
   * Get all models for a provider.
   * @param {string} providerId
   * @param {{ includeRemoved?: boolean }} [options] - Pass `includeRemoved: true`
   *   to include soft-removed (tombstoned) rows. Normal list/picker callers
   *   must never see removed rows; historical resolution uses
   *   `getHistoricalModel` / `getModelById` instead.
   * @returns {Array<Object>}
   */
  getModels(providerId, { includeRemoved = false } = {}) {
    return modelOps.getModels(this.db, providerId, { includeRemoved });
  }

  /**
   * Add a model to a provider. Built-in and custom providers share this path
   * (FRD-built-in-model-choices.md §0 "users can add and remove model choices
   * for built-in providers just as they can for custom providers"). If a
   * soft-removed row already exists for this (provider, modelId) pair, it is
   * restored and updated in place rather than duplicated.
   * @param {string} providerId
   * @param {Object} data
   * @returns {Object} Created (or restored) model
   */
  addModel(providerId, data) {
    const provider = this.getById(providerId);
    if (!provider) throw new Error('Provider not found');
    return modelOps.addModel(this.db, providerId, data);
  }

  /**
   * Get a model by its row ID. Unfiltered by `removed_at` -- historical
   * resolution (e.g. a session referencing a since-removed choice) looks
   * models up by their known row id, so removed rows must still resolve.
   * @param {string} id - Model row ID
   * @returns {Object|null}
   */
  getModelById(id) {
    return modelOps.getModelById(this.db, id);
  }

  /**
   * Resolve the row a session should use to keep displaying/running a given
   * (provider, modelId string) pair, even if it has since been disabled or
   * soft-removed.
   * @returns {Object|null}
   */
  getHistoricalModel(providerId, modelId) {
    return modelOps.getHistoricalModel(this.db, providerId, modelId);
  }

  /**
   * Update an existing model
   * @param {string} id - Model row ID
   * @returns {Object} Updated model
   */
  updateModel(id, data) {
    const current = this.getModelById(id);
    if (!current) throw new Error('Model not found');
    const provider = this.getById(current.providerId);
    return modelOps.updateModel(this.db, id, data, { current, provider });
  }

  /**
   * Remove a model from a provider (soft-removal; see providerModelOperations.js).
   * @param {string} modelId - Model row ID (not the model string like "claude-opus-4-6")
   * @returns {Object} The soft-removed model row
   */
  removeModel(modelId) {
    const model = this.getModelById(modelId);
    if (!model) throw new Error('Model not found');
    return modelOps.removeModel(this.db, modelId, model);
  }

  reorderModels(providerId, orderedRowIds) {
    return modelOps.reorderModels(this.db, providerId, orderedRowIds);
  }

  /**
   * Look up the provider that owns a given model ID string.
   * Returns null if the model belongs to the built-in Anthropic provider or is not found
   * (in those cases the Claude SDK handles it with its defaults).
   *
   * @param {string|null|undefined} modelId - The model string, e.g. "my-custom-sonnet-v2"
   * @returns {Object|null} Full provider object (including models array), or null
   */
  getProviderByModelId(modelId) {
    if (!modelId) return null;

    // Tier names (sonnet, opus, haiku) are handled by the SDK — no custom provider needed
    if (MODEL_TIER_ALIASES.includes(modelId.toLowerCase())) {
      return null;
    }

    // Prefer custom providers over built-ins for duplicate model IDs. This
    // preserves user-managed OpenAI providers (alternate base URLs, keys, or
    // env vars) even when official OpenAI models are also seeded built-ins.
    const row = this.db
      .prepare(
        `SELECT p.id FROM providers p
         JOIN provider_models pm ON p.id = pm.provider_id
         WHERE pm.model_id = ?
         ORDER BY p.is_built_in ASC, p.name ASC`
      )
      .get(modelId);

    if (!row) {
      // Model not found in any custom provider — use Anthropic SDK defaults
      return null;
    }

    // Use getById so we get the full provider object including models
    const provider = this.getById(row.id);
    if (!provider) return null;

    // Built-in **Anthropic** provider falls through to SDK defaults (keeps
    // historical behavior of letting @anthropic-ai/claude-agent-sdk pick its
    // own env). Built-in OpenAI (or any future non-Anthropic built-in) still
    // needs its env vars to flow, so we return the provider object.
    if (provider.isBuiltIn && provider.kind === 'anthropic') {
      return null;
    }

    return provider;
  }

  /**
   * Look up provider metadata for a model without applying runtime env fallback
   * rules. Unlike getProviderByModelId, this returns built-in Anthropic too.
   *
   * @param {string|null|undefined} modelId
   * @returns {Object|null}
   */
  getProviderMetadataByModelId(modelId) {
    if (!modelId) return null;

    if (MODEL_TIER_ALIASES.includes(modelId.toLowerCase())) {
      return this.getById('anthropic-default');
    }

    const row = this.db
      .prepare(
        `SELECT p.id FROM providers p
         JOIN provider_models pm ON p.id = pm.provider_id
         WHERE pm.model_id = ?
         ORDER BY p.is_built_in ASC, p.name ASC`
      )
      .get(modelId);

    return row ? this.getById(row.id) : null;
  }

  /**
   * Enumerate every valid model id: the distinct `model_id` values from the
   * `provider_models` table (built-in + user-registered) unioned with the
   * SDK-handled tier aliases. Returned sorted and de-duplicated. This is the
   * single source of truth for "is this model id valid?" checks.
   *
   * @returns {string[]} Sorted distinct list of valid model ids
   */
  getAllModelIds() {
    const rows = this.db
      .prepare('SELECT DISTINCT model_id FROM provider_models')
      .all();
    const ids = new Set(rows.map((row) => row.model_id));
    for (const alias of MODEL_TIER_ALIASES) {
      ids.add(alias);
    }
    return Array.from(ids).sort();
  }

  /**
   * Resolve a provider's agent type from its id.
   * @param {string|null|undefined} providerId
   * @returns {string|null} 'claude-code' for anthropic-kind, 'codex' for openai-kind,
   *   or null if the provider is unknown.
   */
  getAgentTypeForProvider(providerId) {
    if (!providerId) return null;
    const provider = this.getById(providerId);
    if (!provider) return null;
    return AGENT_TYPE_BY_KIND[provider.kind] || null;
  }
}
