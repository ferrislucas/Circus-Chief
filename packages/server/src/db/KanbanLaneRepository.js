import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Kanban lane repository class
 */
export class KanbanLaneRepository extends BaseRepository {
  constructor() {
    super('kanban_lanes', KanbanLaneRepository.#mapLane);
  }

  static #mapLane(row) {
    return {
      id: row.id,
      boardId: row.board_id,
      name: row.name,
      sortOrder: row.sort_order,
      onEnterTemplateId: row.on_enter_template_id,
      onEnterPrompt: row.on_enter_prompt,
      onEnterMode: row.on_enter_mode,
      onEnterModel: row.on_enter_model,
      onEnterEffortLevel: row.on_enter_effort_level,
      onEnterThinkingEnabled: row.on_enter_thinking_enabled === null ? null : !!row.on_enter_thinking_enabled,
      onEnterAutoRescheduleEnabled: !!row.on_enter_auto_reschedule_enabled,
      onEnterRescheduleDelayMinutes: row.on_enter_reschedule_delay_minutes,
      onEnterRescheduleOnTokenLimit: row.on_enter_reschedule_on_token_limit === null ? null : !!row.on_enter_reschedule_on_token_limit,
      onEnterRescheduleOnServiceError: row.on_enter_reschedule_on_service_error === null ? null : !!row.on_enter_reschedule_on_service_error,
      onEnterMaxRescheduleCount: row.on_enter_max_reschedule_count,
      onEnterMaxTotalTokens: row.on_enter_max_total_tokens,
      onEnterRescheduleAtTokenCount: row.on_enter_reschedule_at_token_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all lanes for a board, ordered by sort_order
   * @param {string} boardId
   * @returns {Array}
   */
  getByBoardId(boardId) {
    const rows = this.db
      .prepare('SELECT * FROM kanban_lanes WHERE board_id = ? ORDER BY sort_order')
      .all(boardId);
    return this.mapAll(rows);
  }

  /**
   * Create a new lane
   * @param {string} boardId
   * @param {Object} data
   * @param {string} data.name
   * @param {number} [data.sortOrder]
   * @param {string|null} [data.onEnterTemplateId]
   * @param {string|null} [data.onEnterPrompt]
   * @returns {Object}
   */
  create(boardId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();

    // If no sortOrder provided, put it at the end
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined || sortOrder === null) {
      const maxRow = this.db
        .prepare('SELECT MAX(sort_order) as max_order FROM kanban_lanes WHERE board_id = ?')
        .get(boardId);
      sortOrder = (maxRow?.max_order ?? -1) + 1;
    }

    this.db
      .prepare(
        `INSERT INTO kanban_lanes (
          id, board_id, name, sort_order, on_enter_template_id, on_enter_prompt,
          on_enter_mode, on_enter_model, on_enter_effort_level, on_enter_thinking_enabled,
          on_enter_auto_reschedule_enabled, on_enter_reschedule_delay_minutes,
          on_enter_reschedule_on_token_limit, on_enter_reschedule_on_service_error,
          on_enter_max_reschedule_count, on_enter_max_total_tokens,
          on_enter_reschedule_at_token_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, boardId, data.name, sortOrder,
        data.onEnterTemplateId || null,
        data.onEnterPrompt || null,
        data.onEnterMode || null,
        data.onEnterModel || null,
        data.onEnterEffortLevel || null,
        data.onEnterThinkingEnabled === undefined ? null : (data.onEnterThinkingEnabled ? 1 : 0),
        data.onEnterAutoRescheduleEnabled ? 1 : 0,
        data.onEnterRescheduleDelayMinutes ?? 15,
        data.onEnterRescheduleOnTokenLimit === undefined ? 1 : (data.onEnterRescheduleOnTokenLimit ? 1 : 0),
        data.onEnterRescheduleOnServiceError === undefined ? 1 : (data.onEnterRescheduleOnServiceError ? 1 : 0),
        data.onEnterMaxRescheduleCount ?? null,
        data.onEnterMaxTotalTokens ?? null,
        data.onEnterRescheduleAtTokenCount ?? null,
        now, now
      );

    return this.getById(id);
  }

  /**
   * Update a lane
   * @param {string} id
   * @param {Object} data
   * @param {string} [data.name]
   * @param {number} [data.sortOrder]
   * @param {string|null} [data.onEnterTemplateId]
   * @param {string|null} [data.onEnterPrompt]
   * @returns {Object}
   */
  update(id, data) {
    // Field mapping: camelCase -> snake_case
    const fieldMap = {
      name: 'name',
      sortOrder: 'sort_order',
      onEnterTemplateId: 'on_enter_template_id',
      onEnterPrompt: 'on_enter_prompt',
      onEnterMode: 'on_enter_mode',
      onEnterModel: 'on_enter_model',
      onEnterEffortLevel: 'on_enter_effort_level',
      onEnterThinkingEnabled: 'on_enter_thinking_enabled',
      onEnterAutoRescheduleEnabled: 'on_enter_auto_reschedule_enabled',
      onEnterRescheduleDelayMinutes: 'on_enter_reschedule_delay_minutes',
      onEnterRescheduleOnTokenLimit: 'on_enter_reschedule_on_token_limit',
      onEnterRescheduleOnServiceError: 'on_enter_reschedule_on_service_error',
      onEnterMaxRescheduleCount: 'on_enter_max_reschedule_count',
      onEnterMaxTotalTokens: 'on_enter_max_total_tokens',
      onEnterRescheduleAtTokenCount: 'on_enter_reschedule_at_token_count',
    };

    const updates = [];
    const values = [];

    // Build update clauses dynamically
    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
      if (data[camelKey] !== undefined) {
        updates.push(`${snakeKey} = ?`);

        // Handle boolean conversions for specific fields
        if (camelKey === 'onEnterThinkingEnabled') {
          values.push(data[camelKey] === null ? null : (data[camelKey] ? 1 : 0));
        } else if (camelKey === 'onEnterAutoRescheduleEnabled' ||
                   camelKey === 'onEnterRescheduleOnTokenLimit' ||
                   camelKey === 'onEnterRescheduleOnServiceError') {
          values.push(data[camelKey] ? 1 : 0);
        } else {
          values.push(data[camelKey]);
        }
      }
    }

    if (updates.length === 0) return this.getById(id);

    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE kanban_lanes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Reorder lanes based on an array of lane IDs
   * @param {string} boardId
   * @param {string[]} laneIds - Ordered array of lane IDs
   */
  reorder(boardId, laneIds) {
    const now = Date.now();

    databaseManager.transaction(() => {
      const updateStmt = this.db.prepare(
        'UPDATE kanban_lanes SET sort_order = ?, updated_at = ? WHERE id = ? AND board_id = ?'
      );

      laneIds.forEach((laneId, index) => {
        updateStmt.run(index, now, laneId, boardId);
      });
    });
  }

  /**
   * Get a single lane with its board info
   * @param {string} id
   * @returns {Object|null}
   */
  getById(id) {
    const row = this.db.prepare('SELECT * FROM kanban_lanes WHERE id = ?').get(id);
    return this.map(row);
  }

  /**
   * Get lane by ID with template info (for on-enter triggers)
   * @param {string} id
   * @returns {Object|null}
   */
  getByIdWithTemplate(id) {
    const row = this.db
      .prepare(
        `SELECT kl.*, st.name as template_name, st.prompt as template_prompt
         FROM kanban_lanes kl
         LEFT JOIN session_templates st ON kl.on_enter_template_id = st.id
         WHERE kl.id = ?`
      )
      .get(id);

    if (!row) return null;

    const mappedLane = this.map(row);
    return {
      ...mappedLane,
      template: row.template_name
        ? {
            id: row.on_enter_template_id,
            name: row.template_name,
            prompt: row.template_prompt,
          }
        : null,
    };
  }

  /**
   * Delete a lane
   * @param {string} id
   */
  delete(id) {
    super.delete(id);
  }
}
