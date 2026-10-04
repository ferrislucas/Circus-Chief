import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { TIER_REF_PREFIX } from '@circuschief/shared';

/**
 * Build a 400-coded error for invalid tier member sets. The tiers API maps
 * `statusCode` to the response status so repository callers get a 400
 * instead of a raw SQLite constraint error (500).
 * @param {string} message
 * @returns {Error}
 */
function tierMemberError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

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
    const rows = this.db.prepare(
      `SELECT
        t.id AS tier_id, t.name AS tier_name, t.description AS tier_description,
        t.created_at AS tier_created_at, t.updated_at AS tier_updated_at,
        m.id AS member_id, m.tier_id AS member_tier_id, m.provider_id AS member_provider_id,
        m.model_id AS member_model_id, m.position AS member_position,
        m.created_at AS member_created_at
       FROM model_tiers t
       LEFT JOIN model_tier_members m ON m.tier_id = t.id
       ORDER BY t.name ASC, m.position ASC, m.created_at ASC`
    ).all();

    const tiers = new Map();
    for (const row of rows) {
      let tier = tiers.get(row.tier_id);
      if (!tier) {
        tier = {
          id: row.tier_id,
          name: row.tier_name,
          description: row.tier_description ?? null,
          createdAt: row.tier_created_at,
          updatedAt: row.tier_updated_at,
          members: [],
        };
        tiers.set(tier.id, tier);
      }
      if (row.member_id) {
        tier.members.push({
          id: row.member_id,
          tierId: row.member_tier_id,
          providerId: row.member_provider_id,
          modelId: row.member_model_id,
          position: row.member_position,
          createdAt: row.member_created_at,
        });
      }
    }
    return [...tiers.values()];
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

  /**
   * Validate a member set before insert. Guards the UNIQUE(tier_id, position)
   * and UNIQUE(tier_id, provider_id, model_id) indexes plus NOT NULL columns
   * so bad input throws a 400-coded error instead of a raw SQLite error.
   * A missing position defaults to array order (not 0, which would collide).
   * Gaps are allowed — callers such as single-member tiers may persist
   * non-zero positions.
   * @param {Array} members
   * @returns {Array} Members with normalized positions
   */
  #validateMembers(members) {
    if (!Array.isArray(members)) throw tierMemberError('Tier members must be an array');
    const pairs = new Set();
    const positions = new Set();
    return members.map((member, index) => {
      if (!member || typeof member.providerId !== 'string' || member.providerId.length === 0) {
        throw tierMemberError(`Tier member at index ${index} must have a non-empty providerId`);
      }
      if (typeof member.modelId !== 'string' || member.modelId.length === 0) {
        throw tierMemberError(`Tier member at index ${index} must have a non-empty modelId`);
      }
      if (member.modelId.startsWith(TIER_REF_PREFIX)) {
        throw tierMemberError(
          `Tier member modelIds cannot use the reserved "${TIER_REF_PREFIX}" prefix`
        );
      }
      const position = member.position ?? index;
      if (!Number.isInteger(position) || position < 0) {
        throw tierMemberError(`Tier member at index ${index} must have a non-negative integer position`);
      }
      const pair = `${member.providerId}\0${member.modelId}`;
      if (pairs.has(pair)) throw tierMemberError('Duplicate tier member provider/model pair');
      pairs.add(pair);
      if (positions.has(position)) throw tierMemberError(`Duplicate tier member position ${position}`);
      positions.add(position);
      return { ...member, position };
    });
  }

  #insertMembers(tierId, members, now) {
    const stmt = this.db.prepare(
      `INSERT INTO model_tier_members (id, tier_id, provider_id, model_id, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const member of this.#validateMembers(members)) {
      stmt.run(
        databaseManager.generateId(),
        tierId,
        member.providerId,
        member.modelId,
        member.position,
        now
      );
    }
  }
}
