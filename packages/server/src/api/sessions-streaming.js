import { Router } from 'express';
import { workLogs } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { textAccumulators, thinkingAccumulators } from '../services/streamEventHandler.js';
import { requireSession } from '../middleware/sessionLookup.js';

const router = Router();

// GET /api/sessions/:id/work-logs - Get work logs for session
router.get('/:id/work-logs', requireSession, (req, res) => {
  // Return work logs grouped by message ID
  const grouped = workLogs.getBySessionIdGrouped(req.params.id);
  res.json(grouped);
});

// GET /api/sessions/:id/streaming-state - Get current streaming snapshot for a running session
// Returns recent pending work logs, accumulated partial text, and thinking
router.get('/:id/streaming-state', requireSession, (req, res) => {
  const sessionId = req.params.id;
  const pendingWorkLogs = workLogs.getRecentPendingBySessionId(sessionId);
  const partialText = textAccumulators.get(sessionId) || '';
  const thinking = thinkingAccumulators.get(sessionId) || null;

  res.json({
    workLogs: pendingWorkLogs,
    partialText,
    thinking,
  });
});

// POST /api/sessions/:id/work-logs - Create work log (for testing)
router.post('/:id/work-logs', requireSession, (req, res) => {
  const { type, content, toolName, messageId } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: 'Type and content are required' });
  }

  const log = workLogs.create(req.params.id, type, content, { messageId: messageId || null, toolName: toolName || null });

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_WORK_LOG, {
    sessionId: req.params.id,
    log,
  });

  res.status(201).json(log);
});

// POST /api/sessions/:id/partial-text - Set partial text (for testing)
router.post('/:id/partial-text', requireSession, (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Text must be a string' });
  }

  textAccumulators.set(req.params.id, text);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
    sessionId: req.params.id,
    text,
  });

  res.status(201).json({ text });
});

// POST /api/sessions/:id/thinking - Set thinking (for testing)
router.post('/:id/thinking', requireSession, (req, res) => {
  const { thinking } = req.body;
  if (typeof thinking !== 'string') {
    return res.status(400).json({ error: 'Thinking must be a string' });
  }

  thinkingAccumulators.set(req.params.id, thinking);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
    sessionId: req.params.id,
    thinking,
  });

  res.status(201).json({ thinking });
});

export default router;
