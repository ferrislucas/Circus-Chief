import { Router } from 'express';
import { sessions } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { executeHookAsync } from '../services/hookService.js';
import * as gitService from '../services/gitService.js';
import { releaseLaneSlotForArchivedSession } from '../services/kanbanService.js';

const router = Router();

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', requireSessionAndProject, async (req, res) => {
  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(req.session_.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const { cleanup, deleteWorktree } = req.body || {};

  let updated = sessions.update(req.params.id, { archived: true });

  // Execute project cleanup command if cleanup requested and project has one configured
  // Only run for worktree sessions - branch-mode sessions have nothing to clean up
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  // Runs before worktree deletion so the hook sees the live worktree as its cwd (FR-6).
  if (cleanup && req.project?.onSessionDeleted && req.session_.gitWorktree && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

  // Delete the git worktree from disk when requested. Root sessions only —
  // child sessions share the parent's resources. Failure warns and continues
  // (same pattern as the DELETE path), keeping gitWorktree so the record
  // stays truthful; the field is cleared only on successful removal.
  if (deleteWorktree && req.session_.gitWorktree && !req.session_.parentSessionId) {
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
      updated = sessions.update(req.params.id, { gitWorktree: null });
    } catch (error) {
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
  }

  // Archival frees the workspace's lane slot (FR-8): cancel its queued entry,
  // revoke its open lane run, and drain to the next live card. Child sessions
  // share the root's card, so only archiving the root touches lane state.
  if (!req.session_.parentSessionId) {
    releaseLaneSlotForArchivedSession(req.params.id);
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
