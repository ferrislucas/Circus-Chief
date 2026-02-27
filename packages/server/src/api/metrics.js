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

export default router;
