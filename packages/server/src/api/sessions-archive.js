import { Router } from 'express';
import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import * as gitService from '../services/gitService.js';

const router = Router();

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', requireSessionAndProject, async (req, res) => {
  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(req.session_.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const { cleanup } = req.body || {};

  let updated;
  if (cleanup && req.session_.gitWorktree && !req.session_.parentSessionId) {
    // Clean up git worktree before archiving
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
    updated = sessions.update(req.params.id, { archived: true, gitWorktree: null });
  } else {
    updated = sessions.update(req.params.id, { archived: true });
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
