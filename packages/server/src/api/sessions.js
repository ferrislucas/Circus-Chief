import { Router } from 'express';
import { sessions, messages, sessionNotes, projects, todos, workLogs } from '../database.js';
import { continueSession, stopSession, restartSession, cleanupActiveSession } from '../services/sessionManager.js';
import { getChanges } from '../services/diffService.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';

const router = Router();

// GET /api/sessions - Get all active/waiting sessions across all projects
router.get('/', (req, res) => {
  const activeSessions = sessions.getActiveAndWaiting();
  res.json(activeSessions);
});

// GET /api/sessions/:id - Get session details
router.get('/:id', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// GET /api/sessions/:id/changes - Get git changes for session
router.get('/:id/changes', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = session.gitWorktree || project.workingDirectory;

  try {
    const changes = await getChanges(directory);
    res.json(changes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/messages - Get session messages
router.get('/:id/messages', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const sessionMessages = messages.getBySessionId(req.params.id);
  res.json(sessionMessages);
});

// GET /api/sessions/:id/work-logs - Get work logs for session
router.get('/:id/work-logs', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Return work logs grouped by message ID
  const grouped = workLogs.getBySessionIdGrouped(req.params.id);
  res.json(grouped);
});

// POST /api/sessions/:id/message - Send follow-up message
router.post('/:id/message', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (session.status !== 'waiting' && session.status !== 'stopped') {
    return res.status(400).json({ error: 'Session is not waiting for input' });
  }

  // Get the project for the working directory
  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    // Use gitWorktree if set, otherwise use the project's working directory
    const workingDirectory = session.gitWorktree || project.workingDirectory;

    // Start continuation (non-blocking)
    continueSession(session.id, content, workingDirectory, project.systemPrompt).catch((error) => {
      console.error('Continue session error:', error);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/stop - Stop running session
router.post('/:id/stop', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Allow stopping running, waiting, or stuck sessions (crashed sessions may be stuck in 'running')
  // Don't allow stopping already completed or errored sessions
  if (session.status === 'completed' || session.status === 'error' || session.status === 'stopped') {
    return res.status(400).json({ error: 'Session is not active' });
  }

  try {
    await stopSession(session.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/restart - Restart a completed/error session
router.post('/:id/restart', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status !== 'completed' && session.status !== 'error') {
    return res.status(400).json({ error: 'Session can only be restarted when completed or in error state' });
  }

  try {
    restartSession(session.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/notes - Get session notes
router.get('/:id/notes', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const notes = sessionNotes.getBySessionId(req.params.id);
  res.json(notes);
});

// POST /api/sessions/:id/notes - Create session note
router.post('/:id/notes', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const note = sessionNotes.create(req.params.id, content);
  res.status(201).json(note);
});

// PUT /api/sessions/:id/notes/:noteId - Update session note
router.put('/:id/notes/:noteId', (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Note not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const updated = sessionNotes.update(req.params.noteId, content);
  res.json(updated);
});

// DELETE /api/sessions/:id/notes/:noteId - Delete session note
router.delete('/:id/notes/:noteId', (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Note not found' });
  }

  sessionNotes.delete(req.params.noteId);
  res.status(204).send();
});

// GET /api/sessions/:id/todos - Get session todos
router.get('/:id/todos', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const sessionTodos = todos.getBySessionId(req.params.id);
  res.json(sessionTodos);
});

// PATCH /api/sessions/:id - Update session settings
router.patch('/:id', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { thinkingEnabled } = req.body;

  // Build update object with only provided fields
  const updateData = {};
  if (thinkingEnabled !== undefined) {
    updateData.thinkingEnabled = Boolean(thinkingEnabled);
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updated = sessions.update(req.params.id, updateData);
  res.json(updated);
});

// GET /api/sessions/:id/summary - Get session summary
router.get('/:id/summary', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
router.post('/:id/summary', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get project info before deletion for hook execution
  const project = projects.getById(session.projectId);

  // Clean up active session if running
  cleanupActiveSession(req.params.id);

  // Clean up summary service debounce timers
  summaryService.cleanupSession(req.params.id);

  // Remove git worktree if session has one
  if (session.gitWorktree && project) {
    try {
      await gitService.removeWorktree(project.workingDirectory, session.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${session.id}:`, error.message);
    }
  }

  // Broadcast deletion to close any open WebSocket subscriptions
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId: req.params.id });

  // Delete session (cascade will handle messages, canvas items, notes)
  sessions.delete(req.params.id);

  // Execute on_session_deleted hook if configured (non-blocking)
  if (project?.onSessionDeleted) {
    executeHookAsync(project.onSessionDeleted, project.workingDirectory, {
      sessionId: session.id,
      projectId: project.id,
      sessionName: session.name,
    });
  }

  res.status(204).send();
});

export default router;
