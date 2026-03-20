import { Router } from 'express';
import { sessions, attachments } from '../database.js';
import { stopSession, restartSession, cleanupActiveSession } from '../services/sessionManager.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { duplicateSession } from '../services/sessionDuplicator.js';
import { configureSchedule, ScheduleError } from '../services/scheduleService.js';

const router = Router();

// POST /api/sessions/:id/stop - Stop running session
router.post('/:id/stop', requireSession, async (req, res) => {
  // Allow stopping running, waiting, or stuck sessions (crashed sessions may be stuck in 'running')
  // Don't allow stopping already errored or stopped sessions
  if (req.session_.status === 'error' || req.session_.status === 'stopped') {
    return res.status(400).json({ error: 'Session is not active' });
  }

  try {
    await stopSession(req.session_.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/restart - Restart a completed/error session
router.post('/:id/restart', requireSession, (req, res) => {
  if (req.session_.status !== 'stopped' && req.session_.status !== 'error') {
    return res.status(400).json({ error: 'Session can only be restarted when stopped or in error state' });
  }

  try {
    restartSession(req.session_.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// POST /api/sessions/:id/schedule - Schedule a follow-up message for an existing session
router.post('/:id/schedule', requireSessionAndProject, async (req, res) => {
  try {
    const updated = configureSchedule(req.session_, req.body);
    res.json(updated);
  } catch (error) {
    if (error instanceof ScheduleError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Schedule session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/duplicate - Duplicate a session
router.post('/:id/duplicate', requireSession, async (req, res) => {
  try {
    const { name } = req.body;
    const newSession = await duplicateSession(req.params.id, { name });

    // Broadcast new session creation to project subscribers
    broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: req.session_.projectId,
      session: newSession,
    });

    res.status(201).json(newSession);
  } catch (error) {
    console.error('Error duplicating session:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', requireSessionAndProject, async (req, res) => {
  // Clean up active session if running
  cleanupActiveSession(req.params.id);

  // Clean up summary service debounce timers
  summaryService.cleanupSession(req.params.id);

  // Remove git worktree if session has one (skip for child sessions - they may share parent's worktree)
  if (req.session_.gitWorktree && !req.session_.parentSessionId) {
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
  }

  // Clean up attachment files from disk
  try {
    attachments.deleteSessionAttachmentsFromDisk(req.workingDirectory, req.session_.id);
  } catch (error) {
    // Log but don't fail - files may already be removed
    console.warn(`Failed to remove attachment files for session ${req.session_.id}:`, error.message);
  }

  // Broadcast deletion to close any open WebSocket subscriptions
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId: req.params.id });

  // Broadcast deletion to project subscribers for real-time list updates
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
  });

  // Delete session (cascade will handle messages, canvas items, notes)
  sessions.delete(req.params.id);

  // Execute on_session_deleted hook if configured (non-blocking)
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  if (req.project?.onSessionDeleted && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

  res.status(204).send();
});

export default router;
