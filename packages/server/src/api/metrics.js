import { Router } from 'express';
import { agentCallLogger } from '../services/agentCallLogger.js';
import { agentCallLogs } from '../database.js';

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

export default router;
