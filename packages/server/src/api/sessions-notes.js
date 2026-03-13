import { Router } from 'express';
import { sessionNotes } from '../database.js';
import { requireSession } from '../middleware/sessionLookup.js';

const router = Router();

// GET /api/sessions/:id/notes - Get session notes
router.get('/:id/notes', requireSession, (req, res) => {
  const notes = sessionNotes.getBySessionId(req.params.id);
  res.json(notes);
});

// POST /api/sessions/:id/notes - Create session note
router.post('/:id/notes', requireSession, (req, res) => {
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
