import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { encrypt, decrypt } from '../services/encryption.js';

/**
 * Provider repository class (replaces ModelProviderRepository).
 *
 * Key differences from the old ModelProviderRepository:
 * - Uses `providers` table (renamed from `model_providers`)
 * - No `default_opus_model` / `default_sonnet_model` / `default_haiku_model` columns
 * - No auto-sync logic (#syncDefaultModels removed)
 * - Auth tokens are encrypted at rest (AES-256-GCM via encryption service)
 * - `getProviderByModelId` includes models (needed for buildProviderEnv)
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
      isBuiltIn: row.is_built_in === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static #mapProviderModel(row) {
    return {
      id: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      displayName: row.display_name,
      description: row.description,
      tier: row.tier,
      createdAt: row.created_at,
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
    } = data;

    this.db
      .prepare(
        `INSERT INTO providers (id, name, base_url, auth_token, api_timeout_ms, additional_env_vars, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        baseUrl,
        encrypt(authToken),
        apiTimeoutMs,
        additionalEnvVars ? JSON.stringify(additionalEnvVars) : null,
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
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.baseUrl !== undefined) {
      updates.push('base_url = ?');
      values.push(data.baseUrl);
    }
    if (data.authToken !== undefined) {
      updates.push('auth_token = ?');
      values.push(encrypt(data.authToken));
    }
    if (data.apiTimeoutMs !== undefined) {
      updates.push('api_timeout_ms = ?');
      values.push(data.apiTimeoutMs);
    }
    if (data.additionalEnvVars !== undefined) {
      updates.push('additional_env_vars = ?');
      values.push(data.additionalEnvVars ? JSON.stringify(data.additionalEnvVars) : null);
    }

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
   * Get all models for a provider
   * @param {string} providerId
   * @returns {Array<Object>}
   */
  getModels(providerId) {
    const rows = this.db
      .prepare('SELECT * FROM provider_models WHERE provider_id = ? ORDER BY created_at ASC')
      .all(providerId);
    return rows.map(ProviderRepository.#mapProviderModel);
  }

  /**
   * Add a model to a provider
   * @param {string} providerId
   * @param {Object} data
   * @param {string} data.modelId
   * @param {string} data.displayName
   * @param {string|null} [data.description]
   * @param {string} [data.tier]
   * @returns {Object} Created model
   */
  addModel(providerId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    const { modelId, displayName, description = null, tier = 'custom' } = data;

    this.db
      .prepare(
        `INSERT INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, providerId, modelId, displayName, description, tier, now);

    return this.getModelById(id);
  }

  /**
   * Get a model by its row ID
   * @param {string} id - Model row ID
   * @returns {Object|null}
   */
  getModelById(id) {
    const row = this.db.prepare('SELECT * FROM provider_models WHERE id = ?').get(id);
    return row ? ProviderRepository.#mapProviderModel(row) : null;
  }

  /**
   * Update an existing model
   * @param {string} id - Model row ID
   * @param {Object} data
   * @param {string} [data.modelId]
   * @param {string} [data.displayName]
   * @param {string|null} [data.description]
   * @param {string} [data.tier]
   * @returns {Object} Updated model
   */
  updateModel(id, data) {
    const updates = [];
    const values = [];

    if (data.modelId !== undefined) {
      updates.push('model_id = ?');
      values.push(data.modelId);
    }
    if (data.displayName !== undefined) {
      updates.push('display_name = ?');
      values.push(data.displayName);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.tier !== undefined) {
      updates.push('tier = ?');
      values.push(data.tier);
    }

    if (updates.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE provider_models SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getModelById(id);
  }

  /**
   * Remove a model from a provider
   * @param {string} modelId - Model row ID (not the model string like "claude-opus-4-6")
   */
  removeModel(modelId) {
    this.db.prepare('DELETE FROM provider_models WHERE id = ?').run(modelId);
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
    const tierNames = ['sonnet', 'opus', 'haiku'];
    if (tierNames.includes(modelId.toLowerCase())) {
      return null;
    }

    // Find which provider owns this model ID
    const row = this.db
      .prepare(
        `SELECT p.id FROM providers p
         JOIN provider_models pm ON p.id = pm.provider_id
         WHERE pm.model_id = ?`
      )
      .get(modelId);

    if (!row) {
      // Model not found in any custom provider — use Anthropic SDK defaults
      return null;
    }

    // Use getById so we get the full provider object including models
    const provider = this.getById(row.id);
    if (!provider) return null;

    // Built-in Anthropic provider falls through to SDK defaults
    if (provider.isBuiltIn) {
      return null;
    }

    return provider;
  }
}
