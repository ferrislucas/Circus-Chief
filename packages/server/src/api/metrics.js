import { Router } from 'express';
import { agentCallLogger } from '../services/agentCallLogger.js';
import { agentCallLogs } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';

const router = Router();

// GET /api/sessions/:sessionId/agent-stats
// Returns aggregated stats for a session grouped by call_type
router.get('/sessions/:sessionId/agent-stats', (req, res) => {
  const stats = agentCallLogger.getSessionStats(req.params.sessionId);
  res.json(stats);
});

// GET /api/sessions/:sessionId/agent-calls?limit=100&offset=0
// Returns detailed call log entries for a session
router.get('/sessions/:sessionId/agent-calls', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const calls = agentCallLogs.getBySessionId(req.params.sessionId, {
    limit: parseInt(limit),
    offset: parseInt(offset),
  });
  res.json(calls);
});

// GET /api/agent-stats?startDate=...&endDate=...
// Returns global stats grouped by agent_type and call_type
router.get('/agent-stats', (req, res) => {
  const now = Date.now();
  const start = req.query.startDate
    ? parseInt(req.query.startDate)
    : now - 7 * 24 * 60 * 60 * 1000;
  const end = req.query.endDate ? parseInt(req.query.endDate) : now;
  const stats = agentCallLogger.getGlobalStats(start, end);
  res.json(stats);
});

// GET /api/agent-calls/filter-options
// Returns distinct values for filter dropdowns
router.get('/agent-calls/filter-options', (req, res) => {
  try {
    const options = agentCallLogger.getFilterOptions();
    res.json(options);
  } catch (err) {
    console.error('Failed to get filter options:', err);
    res.status(500).json({ error: 'Failed to get filter options' });
  }
});

// GET /api/agent-calls?limit=25&offset=0&agentType=...&callType=...&status=...&model=...&sessionId=...&startDate=...&endDate=...&sortBy=...&sortOrder=...
// Returns paginated call logs with optional filters
router.get('/agent-calls', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 25;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const startDate = req.query.startDate ? parseInt(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? parseInt(req.query.endDate) : undefined;

    const result = agentCallLogger.getAll({
      limit,
      offset,
      agentType: req.query.agentType,
      callType: req.query.callType,
      status: req.query.status,
      model: req.query.model,
      sessionId: req.query.sessionId,
      startDate,
      endDate,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
    });

    res.json({
      logs: result.rows,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
    });
  } catch (err) {
    console.error('Failed to get agent call logs:', err);
    res.status(500).json({ error: 'Failed to get agent call logs' });
  }
});

// POST /api/agent-calls
// Seed a fully-formed agent call log entry (for E2E testing only).
// Accepts all fields directly, including computed ones (totalTokens, durationMs).
router.post('/agent-calls', (req, res) => {
  try {
    const {
      sessionId,
      agentType = 'claude-code',
      callType = 'runSession',
      model = null,
      status = 'completed',
      inputTokens = 0,
      outputTokens = 0,
      thinkingTokens = 0,
      cacheReadTokens = 0,
      cacheWriteTokens = 0,
      durationMs = null,
      startedAt = null,
      errorMessage = null,
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const id = databaseManager.generateId();
    const now = Date.now();
    const finalStartedAt = startedAt ?? now;
    const completedAt =
      status === 'completed' || status === 'error'
        ? durationMs != null
          ? finalStartedAt + durationMs
          : now
        : null;
    const totalTokens =
      inputTokens + outputTokens + thinkingTokens + cacheReadTokens + cacheWriteTokens;
    const finalDurationMs = completedAt != null ? completedAt - finalStartedAt : null;

    // Direct INSERT — bypasses create()/complete() flow to allow full control over all fields,
    // including computed ones like totalTokens, durationMs, and startedAt.
    const db = agentCallLogs.db;
    db.prepare(`
      INSERT INTO agent_call_logs (
        id, session_id, agent_type, model, call_type, prompt_length,
        input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, started_at, completed_at, duration_ms, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      agentType,
      model,
      callType,
      inputTokens,
      outputTokens,
      thinkingTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      finalStartedAt,
      completedAt,
      finalDurationMs,
      status,
      errorMessage,
      now
    );

    res.status(201).json(agentCallLogs.getById(id));
  } catch (err) {
    console.error('Failed to seed agent call log:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
