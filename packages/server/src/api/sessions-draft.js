import { Router } from 'express';
import { messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession } from '../middleware/sessionLookup.js';
import { validateDraftSession, startDraft, DraftSessionError } from '../services/draftSessionService.js';

const router = Router();

// PUT /api/sessions/:id/initial-prompt - Update the initial prompt for a draft session
router.put('/:id/initial-prompt', requireSession, (req, res) => {
  const validation = validateDraftSession(req.session_);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Get the request body
  const { prompt } = req.body;

  // Validate prompt is provided and non-empty
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt must be a non-empty string' });
  }

  try {
    const allMessages = messages.getBySessionId(req.session_.id);
    // Find the first user message and update it
    const userMessages = allMessages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No initial prompt found' });
    }

    const initialMessage = userMessages[0];
    const updatedMessage = messages.updateContent(initialMessage.id, prompt);

    // Broadcast the update to session subscribers
    broadcastToSession(req.session_.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
      sessionId: req.session_.id,
      message: updatedMessage,
    });

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error('Update initial prompt error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/start - Start a draft session (waiting status with no assistant messages)
router.post('/:id/start', requireSession, async (req, res) => {
  const validation = validateDraftSession(req.session_);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const updatedSession = await startDraft(req.session_, {
      prompt: req.body.prompt,
      model: req.body.model,
    });

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    if (error instanceof DraftSessionError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Start session error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
