import { Router } from 'express';
import { sessions, messages, sessionNotes, projects } from '../database.js';
import { continueSession, stopSession, endSession } from '../services/sessionManager.js';
import { getChanges } from '../services/diffService.js';

const router = Router();

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

  if (session.status !== 'waiting') {
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
    continueSession(session.id, content, workingDirectory).catch((error) => {
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

  if (session.status !== 'running' && session.status !== 'waiting') {
    return res.status(400).json({ error: 'Session is not active' });
  }

  try {
    await stopSession(session.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/end - End session (mark as completed)
router.post('/:id/end', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status === 'completed') {
    return res.status(400).json({ error: 'Session is already completed' });
  }

  try {
    endSession(session.id);
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

export default router;
