import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Kanban card repository class
 */
export class KanbanCardRepository extends BaseRepository {
  constructor() {
    super('kanban_cards', KanbanCardRepository.#mapCard);
  }

  static #mapCard(row) {
    const card = {
      id: row.id,
      laneId: row.lane_id,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // If session data is joined, include it
    if (row.session_id !== undefined) {
      card.sessions = row.session_id
        ? [
            {
              id: row.session_id,
              name: row.session_name,
              status: row.session_status,
              mode: row.session_mode,
              costUsd: row.session_cost_usd,
              starred: Boolean(row.session_starred),
              prUrl: row.session_pr_url,
              createdAt: row.session_created_at,
              updatedAt: row.session_updated_at,
            },
          ]
        : [];
    }

    return card;
  }

  /**
   * Get all cards for a lane with session data, ordered by sort_order
   * @param {string} laneId
   * @returns {Array}
   */
  getByLaneId(laneId) {
    const rows = this.db
      .prepare(
        `SELECT kc.*,
                kcs.session_id,
                s.name as session_name,
                s.status as session_status,
                s.mode as session_mode,
                s.cost_usd as session_cost_usd,
                s.starred as session_starred,
                s.pr_url as session_pr_url,
                s.created_at as session_created_at,
                s.updated_at as session_updated_at
         FROM kanban_cards kc
         LEFT JOIN kanban_card_sessions kcs ON kc.id = kcs.card_id
         LEFT JOIN sessions s ON kcs.session_id = s.id
         WHERE kc.lane_id = ?
         ORDER BY kc.sort_order`
      )
      .all(laneId);
    return this.mapAll(rows);
  }

  /**
   * Get all cards for a board with session data
   * @param {string} boardId
   * @returns {Array}
   */
  getByBoardId(boardId) {
    const rows = this.db
      .prepare(
        `SELECT kc.*,
                kcs.session_id,
                s.name as session_name,
                s.status as session_status,
                s.mode as session_mode,
                s.cost_usd as session_cost_usd,
                s.starred as session_starred,
                s.pr_url as session_pr_url,
                s.created_at as session_created_at,
                s.updated_at as session_updated_at
         FROM kanban_cards kc
         JOIN kanban_lanes kl ON kc.lane_id = kl.id
         LEFT JOIN kanban_card_sessions kcs ON kc.id = kcs.card_id
         LEFT JOIN sessions s ON kcs.session_id = s.id
         WHERE kl.board_id = ?
         ORDER BY kl.sort_order, kc.sort_order`
      )
      .all(boardId);
    return this.mapAll(rows);
  }

  /**
   * Get the card for a specific session
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getBySessionId(sessionId) {
    const row = this.db
      .prepare(
        `SELECT kc.*,
                kcs.session_id,
                s.name as session_name,
                s.status as session_status,
                s.mode as session_mode,
                s.cost_usd as session_cost_usd,
                s.starred as session_starred,
                s.pr_url as session_pr_url,
                s.created_at as session_created_at,
                s.updated_at as session_updated_at
         FROM kanban_cards kc
         JOIN kanban_card_sessions kcs ON kc.id = kcs.card_id
         LEFT JOIN sessions s ON kcs.session_id = s.id
         WHERE kcs.session_id = ?`
      )
      .get(sessionId);
    return this.map(row);
  }

  /**
   * Create a card for a session in a lane
   * @param {string} laneId
   * @param {string} sessionId
   * @param {Object} [options]
   * @param {number} [options.sortOrder]
   * @returns {Object}
   */
  create(laneId, sessionId, options = {}) {
    const cardId = databaseManager.generateId();
    const cardSessionId = databaseManager.generateId();
    const now = Date.now();

    // If no sortOrder provided, put it at the end
    let sortOrder = options.sortOrder;
    if (sortOrder === undefined || sortOrder === null) {
      const maxRow = this.db
        .prepare('SELECT MAX(sort_order) as max_order FROM kanban_cards WHERE lane_id = ?')
        .get(laneId);
      sortOrder = (maxRow?.max_order ?? -1) + 1;
    }

    return databaseManager.transaction(() => {
      // Create the card
      this.db
        .prepare(
          `INSERT INTO kanban_cards (id, lane_id, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(cardId, laneId, sortOrder, now, now);

      // Link the session to the card
      this.db
        .prepare(
          `INSERT INTO kanban_card_sessions (id, card_id, session_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(cardSessionId, cardId, sessionId, now);

      return this.getBySessionId(sessionId);
    });
  }

  /**
   * Move a card to a different lane
   * @param {string} cardId
   * @param {string} targetLaneId
   * @param {number} [sortOrder]
   * @returns {Object}
   */
  moveToLane(cardId, targetLaneId, sortOrder) {
    const now = Date.now();

    // If no sortOrder provided, put it at the end of the target lane
    let order = sortOrder;
    if (order === undefined || order === null) {
      const maxRow = this.db
        .prepare('SELECT MAX(sort_order) as max_order FROM kanban_cards WHERE lane_id = ?')
        .get(targetLaneId);
      order = (maxRow?.max_order ?? -1) + 1;
    }

    this.db
      .prepare('UPDATE kanban_cards SET lane_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
      .run(targetLaneId, order, now, cardId);

    return this.getById(cardId);
  }

  /**
   * Reorder cards within a lane
   * @param {string} laneId
   * @param {string[]} cardIds - Ordered array of card IDs
   */
  reorder(laneId, cardIds) {
    const now = Date.now();

    databaseManager.transaction(() => {
      const updateStmt = this.db.prepare(
        'UPDATE kanban_cards SET sort_order = ?, updated_at = ? WHERE id = ? AND lane_id = ?'
      );

      cardIds.forEach((cardId, index) => {
        updateStmt.run(index, now, cardId, laneId);
      });
    });
  }

  /**
   * Delete a card (does not delete the session)
   * @param {string} cardId
   */
  delete(cardId) {
    super.delete(cardId);
  }

  /**
   * Get card by ID with full session data
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    const row = this.db
      .prepare(
        `SELECT kc.*,
                kcs.session_id,
                s.name as session_name,
                s.status as session_status,
                s.mode as session_mode,
                s.cost_usd as session_cost_usd,
                s.starred as session_starred,
                s.pr_url as session_pr_url,
                s.created_at as session_created_at,
                s.updated_at as session_updated_at
         FROM kanban_cards kc
         LEFT JOIN kanban_card_sessions kcs ON kc.id = kcs.card_id
         LEFT JOIN sessions s ON kcs.session_id = s.id
         WHERE kc.id = ?`
      )
      .get(id);
    return this.map(row);
  }

  /**
   * Get card with lane info (useful for knowing current lane when moving)
   * @param {string} id
   * @returns {Object|null}
   */
  getByIdWithLane(id) {
    const row = this.db
      .prepare(
        `SELECT kc.*,
                kl.board_id,
                kl.name as lane_name,
                kcs.session_id,
                s.name as session_name,
                s.status as session_status,
                s.mode as session_mode,
                s.cost_usd as session_cost_usd,
                s.starred as session_starred,
                s.pr_url as session_pr_url,
                s.created_at as session_created_at,
                s.updated_at as session_updated_at
         FROM kanban_cards kc
         JOIN kanban_lanes kl ON kc.lane_id = kl.id
         LEFT JOIN kanban_card_sessions kcs ON kc.id = kcs.card_id
         LEFT JOIN sessions s ON kcs.session_id = s.id
         WHERE kc.id = ?`
      )
      .get(id);

    if (!row) return null;

    return {
      ...this.map(row),
      boardId: row.board_id,
      laneName: row.lane_name,
    };
  }
}
