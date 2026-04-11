import { Router } from 'express';
import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { executeHookAsync } from '../services/hookService.js';

const router = Router();

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', requireSessionAndProject, async (req, res) => {
  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(req.session_.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const { cleanup } = req.body || {};

  const updated = sessions.update(req.params.id, { archived: true });

  // Execute project cleanup command if cleanup requested and project has one configured
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  if (cleanup && req.project?.onSessionDeleted && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

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
