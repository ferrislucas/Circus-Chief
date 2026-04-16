import { BaseRepository } from './BaseRepository.js';

/**
 * Compute total tokens from passed values (preferring provided over DB row values).
 */
function computeTotalTokens(provided, row) {
  const finalInput = provided.inputTokens ?? row?.input_tokens ?? 0;
  const finalOutput = provided.outputTokens ?? row?.output_tokens ?? 0;
  const finalThinking = row?.thinking_tokens ?? 0;
  const finalCacheRead = provided.cacheReadTokens ?? row?.cache_read_tokens ?? 0;
  const finalCacheWrite = provided.cacheWriteTokens ?? row?.cache_write_tokens ?? 0;
  return finalInput + finalOutput + finalThinking + finalCacheRead + finalCacheWrite;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    agentType: row.agent_type,
    model: row.model,
    callType: row.call_type,
    promptLength: row.prompt_length,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thinkingTokens: row.thinking_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    status: row.status,
    errorMessage: row.error_message,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
  };
}

export class AgentCallLogRepository extends BaseRepository {
  constructor() {
    super('agent_call_logs', mapRow);
  }

  /**
   * Create a new call log entry
   */
  create({ id, sessionId, conversationId, agentType, model, callType, promptLength, metadata = {} }) {
    const now = Date.now();
    const metadataJson = Object.keys(metadata).length > 0
      ? JSON.stringify(metadata)
      : null;

    this.db
      .prepare(
        `INSERT INTO agent_call_logs (id, session_id, conversation_id, agent_type, model, call_type, prompt_length, metadata, started_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, sessionId, conversationId, agentType, model, callType, promptLength, metadataJson, now, now);
    return this.getById(id);
  }

  /**
   * Update usage tokens during streaming
   */
  updateUsage(
    id,
    { inputTokens, outputTokens, thinkingTokens, cacheReadTokens, cacheWriteTokens }
  ) {
    this.db
      .prepare(
        `UPDATE agent_call_logs SET
        input_tokens = COALESCE(?, input_tokens),
        output_tokens = COALESCE(?, output_tokens),
        thinking_tokens = COALESCE(?, thinking_tokens),
        cache_read_tokens = COALESCE(?, cache_read_tokens),
        cache_write_tokens = COALESCE(?, cache_write_tokens),
        status = 'streaming'
      WHERE id = ?`
      )
      .run(inputTokens, outputTokens, thinkingTokens, cacheReadTokens, cacheWriteTokens, id);
  }

  /**
   * Mark a call as completed or errored
   */
  complete(
    id,
    { success, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, errorMessage }
  ) {
    const now = Date.now();
    const row = this.db
      .prepare(
        'SELECT started_at, input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens FROM agent_call_logs WHERE id = ?'
      )
      .get(id);
    const durationMs = row ? now - row.started_at : null;

    // Compute totalTokens using passed values (if provided) or existing DB values.
    // thinkingTokens is only set via updateUsage() during streaming, so we always
    // read it from the existing row rather than expecting it as a parameter here.
    const totalTokens = computeTotalTokens(
      { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      row
    );

    this.db
      .prepare(
        `UPDATE agent_call_logs SET
        input_tokens = COALESCE(?, input_tokens),
        output_tokens = COALESCE(?, output_tokens),
        cache_read_tokens = COALESCE(?, cache_read_tokens),
        cache_write_tokens = COALESCE(?, cache_write_tokens),
        total_tokens = ?,
        completed_at = ?,
        duration_ms = ?,
        status = ?,
        error_message = ?
      WHERE id = ?`
      )
      .run(
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        now,
        durationMs,
        success ? 'completed' : 'error',
        errorMessage || null,
        id
      );
  }

  /**
   * Build WHERE conditions and params from filter options.
   * @param {Object} options - Filter options
   * @returns {{ conditions: string[], params: any[] }}
   */
  static buildFilters({ agentType, callType, status, model, sessionId, startDate, endDate }) {
    const filterMap = [
      [agentType, 'acl.agent_type = ?'],
      [callType, 'acl.call_type = ?'],
      [status, 'acl.status = ?'],
      [model, 'acl.model = ?'],
      [sessionId, 'acl.session_id = ?'],
      [startDate, 'acl.started_at >= ?'],
      [endDate, 'acl.started_at <= ?'],
    ];

    const conditions = [];
    const params = [];
    for (const [value, condition] of filterMap) {
      if (value) {
        conditions.push(condition);
        params.push(value);
      }
    }
    return { conditions, params };
  }

  /**
   * Get all call logs with optional filtering, sorting, and pagination.
   * Returns { rows, total } where total is the full count (before limit/offset).
   */
  getAll({
    limit = 25,
    offset = 0,
    agentType,
    callType,
    status,
    startDate,
    endDate,
    sessionId,
    model,
    sortBy = 'started_at',
    sortOrder = 'DESC',
  } = {}) {
    const SORTABLE_COLUMNS = [
      'started_at',
      'status',
      'agent_type',
      'call_type',
      'model',
      'total_tokens',
      'duration_ms',
    ];
    const safeSortBy = SORTABLE_COLUMNS.includes(sortBy) ? sortBy : 'started_at';
    const safeSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    const { conditions, params } = AgentCallLogRepository.buildFilters({
      agentType, callType, status, model, sessionId, startDate, endDate,
    });

    const whereClause = conditions.length > 0 ? `WHERE ${  conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM agent_call_logs acl ${whereClause}`)
      .get(...params);
    const total = countRow.count;

    const rows = this.db
      .prepare(
        `SELECT acl.*, s.name AS session_name
         FROM agent_call_logs acl
         LEFT JOIN sessions s ON acl.session_id = s.id
         ${whereClause}
         ORDER BY acl.${safeSortBy} ${safeSortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const mappedRows = rows
      .map((row) => {
        const mapped = mapRow(row);
        if (mapped) mapped.sessionName = row.session_name || null;
        return mapped;
      })
      .filter(Boolean);

    return { rows: mappedRows, total };
  }

  /**
   * Get distinct filter option values from the database.
   * Returns { agentTypes, callTypes, statuses, models }
   */
  getFilterOptions() {
    const agentTypes = this.db
      .prepare(
        'SELECT DISTINCT agent_type FROM agent_call_logs WHERE agent_type IS NOT NULL ORDER BY agent_type'
      )
      .all()
      .map((r) => r.agent_type);
    const callTypes = this.db
      .prepare(
        'SELECT DISTINCT call_type FROM agent_call_logs WHERE call_type IS NOT NULL ORDER BY call_type'
      )
      .all()
      .map((r) => r.call_type);
    const statuses = this.db
      .prepare(
        'SELECT DISTINCT status FROM agent_call_logs WHERE status IS NOT NULL ORDER BY status'
      )
      .all()
      .map((r) => r.status);
    const models = this.db
      .prepare(
        'SELECT DISTINCT model FROM agent_call_logs WHERE model IS NOT NULL ORDER BY model'
      )
      .all()
      .map((r) => r.model);
    return { agentTypes, callTypes, statuses, models };
  }

  /**
   * Get all call logs for a session
   */
  getBySessionId(sessionId, { limit = 100, offset = 0 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_call_logs WHERE session_id = ?
      ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .all(sessionId, limit, offset);
    return this.mapAll(rows);
  }

  /**
   * Get aggregated stats for a session, grouped by call_type
   */
  getSessionStats(sessionId) {
    return this.db
      .prepare(
        `SELECT
        call_type,
        COUNT(*) as call_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        AVG(duration_ms) as avg_duration_ms,
        SUM(duration_ms) as total_duration_ms
      FROM agent_call_logs
      WHERE session_id = ?
      GROUP BY call_type`
      )
      .all(sessionId);
  }

  /**
   * Get global stats grouped by agent_type within a date range
   */
  getGlobalStats(startDate, endDate) {
    return this.db
      .prepare(
        `SELECT
        agent_type,
        call_type,
        COUNT(*) as call_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        AVG(duration_ms) as avg_duration_ms
      FROM agent_call_logs
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY agent_type, call_type
      ORDER BY total_tokens DESC`
      )
      .all(startDate, endDate);
  }

  /**
   * Delete all call logs from the database.
   * Returns the number of deleted rows.
   */
  deleteAll() {
    const result = this.db.prepare('DELETE FROM agent_call_logs').run();
    return result.changes;
  }
}
