import { Router } from 'express';
import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession } from '../middleware/sessionLookup.js';

const router = Router();

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', requireSession, (req, res) => {
  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(req.session_.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const updated = sessions.update(req.params.id, { archived: true });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/unarchive - Unarchive a session
router.post('/:id/unarchive', requireSession, (req, res) => {
  const updated = sessions.update(req.params.id, { archived: false });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/star - Toggle star status for a session
router.post('/:id/star', requireSession, (req, res) => {
  const updated = sessions.update(req.params.id, { starred: !req.session_.starred });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

export default router;
