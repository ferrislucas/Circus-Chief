import { Router } from 'express';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Error message constants
const ERR_SESSION_NOT_FOUND = 'Session not found';

const router = Router();

// DELETE /api/sessions/:id/canvas/bulk-delete-permanent - Permanently delete multiple items from trash
// NOTE: This must be defined BEFORE /:id/canvas/:itemId to avoid Express matching it as :itemId = "bulk-delete-permanent"
router.delete('/:id/canvas/bulk-delete-permanent', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const { itemIds } = req.body;
  if (!Array.isArray(itemIds)) {
    return res.status(400).json({ error: 'itemIds must be an array' });
  }

  if (itemIds.length === 0) {
    return res.json({ deletedCount: 0 });
  }

  // Verify all items are in trash and belong to this session
  for (const itemId of itemIds) {
    const item = canvasItems.getById(itemId);
    if (!item || item.sessionId !== req.params.id) {
      return res.status(404).json({ error: `Item ${itemId} not found in session` });
    }
    if (!item.deletedAt) {
      return res.status(400).json({ error: `Item ${itemId} is not in trash (cannot permanently delete active items)` });
    }
  }

  // Expand to include all versions of each file
  const expandedIds = canvasItems.expandToAllVersions(itemIds, { deletedOnly: true });
  const deletedCount = canvasItems.permanentDeleteBatch(expandedIds);

  // Broadcast each deleted item to session subscribers
  expandedIds.forEach(itemId => {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId });
  });

  res.json({ deletedCount, deletedIds: expandedIds });
});

// DELETE /api/sessions/:id/canvas/:itemId - Soft delete canvas item (move to trash)
router.delete('/:id/canvas/:itemId', (req, res) => {
  const item = canvasItems.getById(req.params.itemId);
  if (!item || item.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }

  // Soft delete instead of hard delete
  const deletedItem = canvasItems.softDelete(req.params.itemId);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId: req.params.itemId });

  res.json(deletedItem);
});

// GET /api/sessions/:id/canvas-trash - List deleted items in trash
router.get('/:id/canvas-trash', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const items = canvasItems.getDeletedBySessionId(req.params.id);
  // Strip content/data from list responses to reduce payload size.
  res.json(items.map(({ content: _content, data: _data, ...meta }) => meta));
});

// POST /api/sessions/:id/canvas/:itemId/recover - Recover a single item from trash
router.post('/:id/canvas/:itemId/recover', (req, res) => {
  const item = canvasItems.getById(req.params.itemId);
  if (!item || item.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }
  if (!item.deletedAt) {
    return res.status(400).json({ error: 'Item is not deleted' });
  }

  const recoveredItem = canvasItems.recover(req.params.itemId);

  // Broadcast recovery - same as add
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item: recoveredItem });

  res.json(recoveredItem);
});

// POST /api/sessions/:id/canvas-trash/recover-file/:filename - Recover all versions of a file
router.post('/:id/canvas-trash/recover-file/:filename', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const { filename } = req.params;
  canvasItems.recoverByFilename(req.params.id, filename);
  const items = canvasItems.getAllVersionsByFilename(req.params.id, filename);

  // Broadcast each recovered item
  items.forEach(item => {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
  });

  res.json({ recovered: items.length });
});

// DELETE /api/sessions/:id/canvas/:itemId/permanent - Permanently delete from trash
router.delete('/:id/canvas/:itemId/permanent', (req, res) => {
  const item = canvasItems.getById(req.params.itemId);
  if (!item || item.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }
  if (!item.deletedAt) {
    return res.status(400).json({ error: 'Item must be in trash before permanent deletion' });
  }

  canvasItems.permanentDelete(req.params.itemId);
  res.status(204).send();
});

// POST /api/sessions/:id/canvas/bulk-delete - Soft delete multiple items
router.post('/:id/canvas/bulk-delete', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const { itemIds } = req.body;
  if (!Array.isArray(itemIds)) {
    return res.status(400).json({ error: 'itemIds must be an array' });
  }

  if (itemIds.length === 0) {
    return res.json({ deletedCount: 0 });
  }

  // Verify all items belong to this session
  for (const itemId of itemIds) {
    const item = canvasItems.getById(itemId);
    if (!item || item.sessionId !== req.params.id) {
      return res.status(404).json({ error: `Item ${itemId} not found in session` });
    }
  }

  // Expand to include all versions of each file
  const expandedIds = canvasItems.expandToAllVersions(itemIds, { activeOnly: true });
  const deletedCount = canvasItems.softDeleteBatch(expandedIds);

  // Broadcast each deleted item to session subscribers
  expandedIds.forEach(itemId => {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId });
  });

  res.json({ deletedCount, deletedIds: expandedIds });
});

// POST /api/sessions/:id/canvas/bulk-recover - Recover multiple items from trash
router.post('/:id/canvas/bulk-recover', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const { itemIds } = req.body;
  if (!Array.isArray(itemIds)) {
    return res.status(400).json({ error: 'itemIds must be an array' });
  }

  if (itemIds.length === 0) {
    return res.json({ recoveredCount: 0 });
  }

  // Validate all items belong to this session
  for (const itemId of itemIds) {
    const item = canvasItems.getById(itemId);
    if (!item || item.sessionId !== req.params.id) {
      return res.status(404).json({ error: `Item ${itemId} not found in session` });
    }
  }

  // Expand to include all versions of each file
  const expandedIds = canvasItems.expandToAllVersions(itemIds, { deletedOnly: true });
  const recoveredCount = canvasItems.recoverBatch(expandedIds);

  // Broadcast each recovered item to session subscribers
  expandedIds.forEach(itemId => {
    const item = canvasItems.getById(itemId);
    if (item) {
      broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
    }
  });

  res.json({ recoveredCount, recoveredIds: expandedIds });
});

export default router;
