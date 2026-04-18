import { Router } from 'express';
import { sessions, attachments, sessionSummaries } from '../database.js';
import { cleanupActiveSession, stopSession, restartSession } from '../services/sessionManager.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { duplicateSession } from '../services/sessionDuplicator.js';
import { configureSchedule, ScheduleError } from '../services/scheduleService.js';

const router = Router();

// GET /api/sessions/:id/summary - Get session summary
router.get('/:id/summary', requireSession, async (req, res) => {
  // Check if generateIfMissing query param is set
  const generateIfMissing = req.query.generate === 'true';

  try {
    const summary = await summaryService.getSummary(req.params.id, generateIfMissing);
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/summary - Generate/regenerate session summary
router.post('/:id/summary', requireSession, async (req, res) => {
  try {
    const summary = await summaryService.regenerateSummary(req.params.id);
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }
    res.status(201).json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id/summary - Directly set summary data (for testing/seeding)
router.put('/:id/summary', requireSession, async (req, res) => {
  try {
    const summary = sessionSummaries.upsert(req.params.id, req.body);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', requireSessionAndProject, async (req, res) => {
  // Collect all descendant session IDs before any deletions
  // (database ON DELETE SET NULL would orphan them otherwise)
  const descendantIds = sessions.getAllDescendantIds(req.params.id);

  // Helper: clean up and delete a single session by ID
  const cleanupAndDeleteSession = async (sessionId) => {
    // Clean up active session if running
    cleanupActiveSession(sessionId);

    // Clean up summary service debounce timers
    summaryService.cleanupSession(sessionId);

    // Clean up attachment files from disk
    try {
      attachments.deleteSessionAttachmentsFromDisk(req.workingDirectory, sessionId);
    } catch (error) {
      console.warn(`Failed to remove attachment files for session ${sessionId}:`, error.message);
    }

    // Broadcast deletion to close any open WebSocket subscriptions
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId });

    // Delete session (cascade will handle messages, canvas items, notes)
    sessions.delete(sessionId);
  };

  // Delete all descendants first (leaves before branches to avoid orphaning)
  for (const descendantId of descendantIds.reverse()) {
    await cleanupAndDeleteSession(descendantId);
  }

  // Remove git worktree if parent session has one (skip for child sessions - they may share parent's worktree)
  if (req.session_.gitWorktree && !req.session_.parentSessionId) {
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
  }

  // Clean up and delete the parent session itself
  await cleanupAndDeleteSession(req.params.id);

  // Broadcast deletion to project subscribers for real-time list updates
  // (sends one event per deleted session so the frontend can remove them all)
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
  });

  for (const descendantId of descendantIds) {
    broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
      projectId: req.session_.projectId,
      sessionId: descendantId,
    });
  }

  // Execute on_session_deleted hook if configured (non-blocking)
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  if (req.project?.onSessionDeleted && req.session_.gitWorktree && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

  res.status(204).send();
});

export default router;
