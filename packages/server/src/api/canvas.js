import { Router } from 'express';
import multer from 'multer';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/sessions/:id/canvas - Add canvas item
router.post('/:id/canvas', upload.single('file'), (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  let itemData;

  if (req.file) {
    // File upload (image)
    const base64 = req.file.buffer.toString('base64');
    itemData = {
      type: 'image',
      data: base64,
      mimeType: req.file.mimetype,
      filename: req.file.originalname,
      label: req.body.label || null,
    };
  } else {
    // JSON body (markdown, text, json, image)
    const { type, content, data, label, title, width, height } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'Type is required' });
    }

    itemData = {
      type,
      content: content || null,
      data: typeof data === 'object' ? JSON.stringify(data) : data || null,
      label: label || title || null, // Support both 'label' and 'title' fields
      width: width || null,
      height: height || null,
    };
  }

  const item = canvasItems.create(req.params.id, itemData);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });

  res.status(201).json(item);
});

// GET /api/sessions/:id/canvas - List canvas items
router.get('/:id/canvas', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const items = canvasItems.getBySessionId(req.params.id);
  res.json(items);
});

// DELETE /api/sessions/:id/canvas/:itemId - Delete canvas item
router.delete('/:id/canvas/:itemId', (req, res) => {
  const item = canvasItems.getById(req.params.itemId);
  if (!item || item.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }

  canvasItems.delete(req.params.itemId);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { itemId: req.params.itemId });

  res.status(204).send();
});

export default router;
