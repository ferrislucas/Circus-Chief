import { Router } from 'express';
import { sessionNotes } from '../database.js';
import { requireRootSessionAndProject } from '../middleware/sessionLookup.js';

const router = Router();

// GET /api/sessions/:id/notes - Get workflow notes
router.get('/:id/notes', requireRootSessionAndProject, (req, res) => {
  const notes = sessionNotes.getBySessionId(req.rootSessionId);
  res.json(notes);
});

// POST /api/sessions/:id/notes - Create workflow note
router.post('/:id/notes', requireRootSessionAndProject, (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const note = sessionNotes.create(req.rootSessionId, content);
  res.status(201).json(note);
});

// PUT /api/sessions/:id/notes/:noteId - Update workflow note
router.put('/:id/notes/:noteId', requireRootSessionAndProject, (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.rootSessionId) {
    return res.status(404).json({ error: 'Note not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const updated = sessionNotes.update(req.params.noteId, content);
  res.json(updated);
});

// DELETE /api/sessions/:id/notes/:noteId - Delete workflow note
router.delete('/:id/notes/:noteId', requireRootSessionAndProject, (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.rootSessionId) {
    return res.status(404).json({ error: 'Note not found' });
  }

  sessionNotes.delete(req.params.noteId);
  res.status(204).send();
});

export default router;
