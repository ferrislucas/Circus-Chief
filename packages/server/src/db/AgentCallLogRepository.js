import { BaseRepository } from './BaseRepository.js';

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
  create({ id, sessionId, conversationId, agentType, model, callType, promptLength }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agent_call_logs (id, session_id, conversation_id, agent_type, model, call_type, prompt_length, started_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, sessionId, conversationId, agentType, model, callType, promptLength, now, now);
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
    const row = this.db.prepare('SELECT started_at FROM agent_call_logs WHERE id = ?').get(id);
    const durationMs = row ? now - row.started_at : null;
    const totalTokens = (inputTokens || 0) + (outputTokens || 0);

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
}
