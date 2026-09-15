import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Repository for model tiers (cross-model failover).
 *
 * A tier is a named, ordered list of (providerId, modelId) pairs. When a
 * session is bound to a tier, the start path resolves the first healthy member
 * and falls over to subsequent members if the preferred one fails.
 */
export class ModelTierRepository extends BaseRepository {
  constructor() {
    super('model_tiers', ModelTierRepository.#mapTier);
  }

  static #mapTier(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static #mapMember(row) {
    return {
      id: row.id,
      tierId: row.tier_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      position: row.position,
      createdAt: row.created_at,
    };
  }

  /**
   * Get members for a tier, ordered by position.
   * @param {string} tierId
   * @returns {Array<Object>}
   */
  getMembers(tierId) {
    const rows = this.db
      .prepare(
        'SELECT * FROM model_tier_members WHERE tier_id = ? ORDER BY position ASC, created_at ASC'
      )
      .all(tierId);
    return rows.map(ModelTierRepository.#mapMember);
  }

  /**
   * Get all tiers with their members.
   * @returns {Array<Object>}
   */
  getAllWithMembers() {
    const rows = this.db.prepare('SELECT * FROM model_tiers ORDER BY name ASC').all();
    return rows.map((row) => {
      const tier = ModelTierRepository.#mapTier(row);
      return { ...tier, members: this.getMembers(tier.id) };
    });
  }

  /**
   * Get a tier by ID with its members.
   * @param {string} id
   * @returns {Object|null}
   */
  getByIdWithMembers(id) {
    const tier = super.getById(id);
    if (!tier) return null;
    return { ...tier, members: this.getMembers(id) };
  }

  /**
   * Create a new tier with optional members.
   * @param {{ name: string, description?: string|null, members?: Array<{ providerId: string, modelId: string, position: number }> }} data
   * @returns {Object} Created tier with members
   */
  create({ name, description = null, members = [] }) {
    const id = databaseManager.generateId();
    const now = Date.now();

    databaseManager.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO model_tiers (id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, name, description ?? null, now, now);

      this.#insertMembers(id, members, now);
    });

    return this.getByIdWithMembers(id);
  }

  /**
   * Update a tier. When `members` is provided, replaces the full member set.
   * @param {string} id
   * @param {{ name?: string, description?: string|null, members?: Array }} data
   * @returns {Object|null} Updated tier with members
   */
  update(id, { name, description, members }) {
    const tier = super.getById(id);
    if (!tier) return null;

    const now = Date.now();

    databaseManager.transaction(() => {
      const updates = [];
      const values = [];

      if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description ?? null);
      }

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        values.push(now);
        values.push(id);
        this.db.prepare(`UPDATE model_tiers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }

      if (members !== undefined) {
        this.db.prepare('DELETE FROM model_tier_members WHERE tier_id = ?').run(id);
        this.#insertMembers(id, members, now);
      }
    });

    return this.getByIdWithMembers(id);
  }

  /**
   * Delete a tier (CASCADE removes members automatically).
   * @param {string} id
   */
  delete(id) {
    super.delete(id);
  }

  /**
   * Find tiers that reference a given provider (used for cascade cleanup display).
   * @param {string} providerId
   * @returns {Array<Object>}
   */
  findTiersReferencingProvider(providerId) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT t.* FROM model_tiers t
         JOIN model_tier_members m ON t.id = m.tier_id
         WHERE m.provider_id = ?`
      )
      .all(providerId);
    return rows.map(ModelTierRepository.#mapTier);
  }

  /**
   * Find tiers that reference a given (providerId, modelId) pair.
   * @param {string} providerId
   * @param {string} modelId
   * @returns {Array<Object>}
   */
  findTiersReferencingModel(providerId, modelId) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT t.* FROM model_tiers t
         JOIN model_tier_members m ON t.id = m.tier_id
         WHERE m.provider_id = ? AND m.model_id = ?`
      )
      .all(providerId, modelId);
    return rows.map(ModelTierRepository.#mapTier);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  #insertMembers(tierId, members, now) {
    const stmt = this.db.prepare(
      `INSERT INTO model_tier_members (id, tier_id, provider_id, model_id, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const member of members) {
      stmt.run(
        databaseManager.generateId(),
        tierId,
        member.providerId,
        member.modelId,
        member.position ?? 0,
        now
      );
    }
  }
}
