import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Model provider repository class
 */
export class ModelProviderRepository extends BaseRepository {
  constructor() {
    super('model_providers', ModelProviderRepository.#mapProvider);
  }

  static #mapProvider(row) {
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      authToken: row.auth_token,
      defaultOpusModel: row.default_opus_model,
      defaultSonnetModel: row.default_sonnet_model,
      defaultHaikuModel: row.default_haiku_model,
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
   * @returns {Object} - Created provider
   */
  create(data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    const {
      name,
      baseUrl = null,
      authToken = null,
      defaultOpusModel = null,
      defaultSonnetModel = null,
      defaultHaikuModel = null,
      apiTimeoutMs = null,
      additionalEnvVars = null,
    } = data;

    this.db
      .prepare(
        `INSERT INTO model_providers (id, name, base_url, auth_token, default_opus_model, default_sonnet_model, default_haiku_model, api_timeout_ms, additional_env_vars, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        name,
        baseUrl,
        authToken,
        defaultOpusModel,
        defaultSonnetModel,
        defaultHaikuModel,
        apiTimeoutMs,
        additionalEnvVars ? JSON.stringify(additionalEnvVars) : null,
        now,
        now
      );

    // Auto-create provider_models entries for default models
    this.#syncDefaultModels(id, { defaultOpusModel, defaultSonnetModel, defaultHaikuModel });

    return this.getById(id);
  }

  /**
   * Sync provider_models entries based on default model settings
   * @private
   * @param {string} providerId - Provider ID
   * @param {Object} defaults - Object containing defaultOpusModel, defaultSonnetModel, defaultHaikuModel
   */
  #syncDefaultModels(providerId, { defaultOpusModel, defaultSonnetModel, defaultHaikuModel }) {
    const now = Date.now();
    // Use REPLACE to update existing models when default model IDs change
    const upsertModel = this.db.prepare(
      `INSERT OR REPLACE INTO provider_models (id, provider_id, model_id, display_name, description, tier, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    if (defaultOpusModel) {
      const modelId = `${providerId}-opus`;
      upsertModel.run(modelId, providerId, defaultOpusModel, 'Opus', 'Most capable model', 'opus', now);
    }
    if (defaultSonnetModel) {
      const modelId = `${providerId}-sonnet`;
      upsertModel.run(modelId, providerId, defaultSonnetModel, 'Sonnet', 'Balanced model', 'sonnet', now);
    }
    if (defaultHaikuModel) {
      const modelId = `${providerId}-haiku`;
      upsertModel.run(modelId, providerId, defaultHaikuModel, 'Haiku', 'Fast & lightweight model', 'haiku', now);
    }
  }

  /**
   * Get all providers
   * @returns {Array<Object>} - All providers
   */
  getAll() {
    const rows = this.db.prepare('SELECT * FROM model_providers ORDER BY is_built_in DESC, name ASC').all();
    return this.mapAll(rows);
  }

  /**
   * Update a provider
   * @param {string} id - Provider ID
   * @param {Object} data - Updated provider data
   * @returns {Object} - Updated provider
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
      values.push(data.authToken);
    }
    if (data.defaultOpusModel !== undefined) {
      updates.push('default_opus_model = ?');
      values.push(data.defaultOpusModel);
    }
    if (data.defaultSonnetModel !== undefined) {
      updates.push('default_sonnet_model = ?');
      values.push(data.defaultSonnetModel);
    }
    if (data.defaultHaikuModel !== undefined) {
      updates.push('default_haiku_model = ?');
      values.push(data.defaultHaikuModel);
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

      this.db.prepare(`UPDATE model_providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    // Sync default models if any were updated
    if (data.defaultOpusModel !== undefined || data.defaultSonnetModel !== undefined || data.defaultHaikuModel !== undefined) {
      // Get the updated provider to get all current default models
      const provider = this.getById(id);
      this.#syncDefaultModels(id, {
        defaultOpusModel: provider.defaultOpusModel,
        defaultSonnetModel: provider.defaultSonnetModel,
        defaultHaikuModel: provider.defaultHaikuModel,
      });
    }

    return this.getById(id);
  }

  /**
   * Delete a provider (prevents deletion of built-in providers)
   * @param {string} id - Provider ID
   * @throws {Error} - If attempting to delete built-in provider
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
   * Get models for a provider
   * @param {string} providerId - Provider ID
   * @returns {Array<Object>} - Provider models
   */
  getModels(providerId) {
    const rows = this.db.prepare('SELECT * FROM provider_models WHERE provider_id = ? ORDER BY created_at ASC').all(providerId);
    return rows.map(ModelProviderRepository.#mapProviderModel);
  }

  /**
   * Add a model to a provider
   * @param {string} providerId - Provider ID
   * @param {Object} data - Model data
   * @returns {Object} - Created model
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
   * Get a model by ID
   * @param {string} id - Model ID
   * @returns {Object|null} - Model
   */
  getModelById(id) {
    const row = this.db.prepare('SELECT * FROM provider_models WHERE id = ?').get(id);
    return row ? ModelProviderRepository.#mapProviderModel(row) : null;
  }

  /**
   * Remove a model from a provider
   * @param {string} modelId - Model ID
   */
  removeModel(modelId) {
    this.db.prepare('DELETE FROM provider_models WHERE id = ?').run(modelId);
  }

  /**
   * Get provider by model ID (the actual model string like "claude-opus-4-5-20251101")
   * Returns the provider that owns this model, or null if not found (use Anthropic defaults)
   * @param {string} modelId - The model ID string
   * @returns {Object|null} - Provider object or null
   */
  getProviderByModelId(modelId) {
    if (!modelId) return null;

    // Tier names (sonnet, opus, haiku) default to Anthropic (SDK handles them)
    const tierNames = ['sonnet', 'opus', 'haiku'];
    if (tierNames.includes(modelId.toLowerCase())) {
      return null; // Let SDK handle tier names
    }

    // Look up the model in provider_models table
    const row = this.db
      .prepare(
        `SELECT mp.* FROM model_providers mp
         JOIN provider_models pm ON mp.id = pm.provider_id
         WHERE pm.model_id = ?`
      )
      .get(modelId);

    if (!row) {
      // Model not found in any provider - assume Anthropic default
      return null;
    }

    const provider = ModelProviderRepository.#mapProvider(row);

    // If it's the built-in Anthropic provider, return null to use SDK defaults
    if (provider.isBuiltIn) {
      return null;
    }

    return provider;
  }
}
