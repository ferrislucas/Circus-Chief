import { Router } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join, basename } from 'path';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, UpdateCanvasItemRequest } from '@claudetools/shared';
import { upload, handleUploadError } from '../middleware/upload.js';
import {
  isBinaryContent,
  getTypeFromExtension,
  processFileBuffer,
  VALID_INLINE_TYPES,
  validateInlineType,
  buildInlineItemData,
  broadcastCanvasUpdate,
} from './canvas-helpers.js';

// Re-export for tests
export { isBinaryContent, getTypeFromExtension };

const router = Router();

// POST /api/sessions/:id/canvas - Add canvas item
// Supports three modes:
// 1. Multipart mode: FormData with 'file' field - from browser file uploads
// 2. File mode: { filePath } - reads file from disk
// 3. Inline mode: { type, content, filename } - uses provided content directly
router.post('/:id/canvas', upload.single('file'), handleUploadError, (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { filePath, type, content, filename } = req.body;
  let itemData;

  // Mode 1: Multipart file upload from FormData
  if (req.file) {
    const result = processFileBuffer(req.file.buffer, req.file.originalname);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    itemData = result.itemData;
  }
  // Mode 2: File path provided - read from disk
  else if (filePath) {
    if (!existsSync(filePath)) {
      return res.status(400).json({ error: `File not found: ${filePath}` });
    }

    try {
      const fileBuffer = readFileSync(filePath);
      const result = processFileBuffer(fileBuffer, basename(filePath));
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      itemData = result.itemData;
    } catch (err) {
      return res.status(400).json({ error: `Failed to read file: ${err.message}` });
    }
  }
  // Mode 3: Inline content provided - use directly
  else if (content !== undefined && type && filename) {
    const validationError = validateInlineType(type);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    itemData = buildInlineItemData(type, content, filename);
  }
  // No valid mode provided
  else {
    return res.status(400).json({
      error: 'Either file upload, filePath, or (type + content + filename) is required'
    });
  }

  const item = canvasItems.create(req.params.id, itemData);

  // Broadcast to session subscribers
  broadcastCanvasUpdate(req.params.id, item);

  res.status(201).json(item);
});

// PUT /api/sessions/:id/canvas/:itemId - Update canvas item content in-place
router.put('/:id/canvas/:itemId', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const parsed = UpdateCanvasItemRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
  }

  const item = canvasItems.getById(req.params.itemId);
  if (!item) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }

  if (item.sessionId !== req.params.id) {
    return res.status(400).json({ error: 'Canvas item does not belong to this session' });
  }

  if (!VALID_INLINE_TYPES.includes(item.type)) {
    return res.status(400).json({ error: `Cannot update content for type: ${item.type}. Editable types: ${VALID_INLINE_TYPES.join(', ')}` });
  }

  const updatedItem = canvasItems.updateContent(req.params.itemId, parsed.data.content);
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_UPDATE, { item: updatedItem });
  res.json(updatedItem);
});

// GET /api/sessions/:id/canvas - List canvas items
// Returns only latest version of each file (no version metadata exposed)
router.get('/:id/canvas', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get only latest versions (one per filename)
  const items = canvasItems.getLatestVersionsBySessionId(req.params.id);

  // Strip content/data from list responses to reduce payload size.
  // Clients should use GET /canvas/file/:filename/content for inline content.
  res.json(items.map(({ content: _content, data: _data, ...meta }) => meta));
});

// GET /api/sessions/:id/canvas/all - List ALL canvas items (including all versions)
// Returns all versions of each file for the frontend UI
router.get('/:id/canvas/all', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get ALL versions (not just latest)
  const items = canvasItems.getBySessionId(req.params.id);

  // Strip content/data from list responses to reduce payload size.
  res.json(items.map(({ content: _content, data: _data, ...meta }) => meta));
});

// GET /api/sessions/:id/canvas/file/:filename/history/:version - Get historical version of canvas file
// Uses standard versioning: version 1 = oldest, version N = latest (where N = totalVersions)
// NOTE: This route must be defined BEFORE the main file route to match correctly
router.get('/:id/canvas/file/:filename/history/:version', async (req, res) => {
  const { id: sessionId, filename, version } = req.params;
  const versionNum = parseInt(version, 10);

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get all versions of this file (newest first)
  const allVersions = canvasItems.getAllVersionsByFilename(sessionId, filename);
  if (allVersions.length === 0) {
    return res.status(404).json({ error: 'File not found on canvas' });
  }

  // Validate version number
  if (isNaN(versionNum) || versionNum < 1 || versionNum > allVersions.length) {
    return res.status(404).json({
      error: `Version ${versionNum} not found. Available versions: 1-${allVersions.length} (1 = oldest, ${allVersions.length} = latest)`
    });
  }

  // Convert version number to array index
  // allVersions is sorted DESC (newest first): [0] = newest, [length-1] = oldest
  // Standard versioning: version 1 = oldest, version N = newest
  // Mapping: version 1 → index (length-1), version N → index 0
  // Formula: index = length - version
  const index = allVersions.length - versionNum;
  const item = allVersions[index];

  try {
    // Create temp directory for this session
    const tempDir = `/tmp/canvas-${sessionId}`;
    await mkdir(tempDir, { recursive: true });

    // Include version in filename to avoid collisions when viewing multiple versions
    const ext = extname(filename);
    const base = basename(filename, ext);
    const tempFilename = `${base}.v${versionNum}${ext}`;
    const filePath = join(tempDir, tempFilename);

    // Write content based on type
    if (item.type === 'image' || item.type === 'pdf') {
      // Binary: decode base64 and write
      const buffer = Buffer.from(item.data, 'base64');
      await writeFile(filePath, buffer);
    } else if (item.type === 'json') {
      // JSON: write the data field, fallback to content if data is not available
      await writeFile(filePath, item.data || item.content || '{}');
    } else {
      // text/markdown/code: write content field
      await writeFile(filePath, item.content || '');
    }

    // Get file size
    const stats = statSync(filePath);
    const fileSize = stats.size;

    res.json({
      filePath,
      type: item.type,
      mimeType: item.mimeType,
      fileSize,
      createdAt: item.createdAt,
      version: versionNum,
      totalVersions: allVersions.length
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to write file: ${err.message}` });
  }
});

// GET /api/sessions/:id/canvas/file/:filename/content - Get canvas file content inline
// Returns content/data inline in JSON for browser consumption (unlike the temp-file endpoint below)
// Supports ?version=N query param (1-based, 1 = oldest)
router.get('/:id/canvas/file/:filename/content', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const allVersions = canvasItems.getAllVersionsByFilename(req.params.id, req.params.filename);
  if (allVersions.length === 0) return res.status(404).json({ error: 'File not found' });

  // Support ?version=N (1-based, 1 = oldest)
  const versionParam = parseInt(req.query.version);
  let item;
  if (!isNaN(versionParam) && versionParam >= 1 && versionParam <= allVersions.length) {
    // allVersions is sorted DESC (newest first): [0] = newest, [length-1] = oldest
    // Standard versioning: version 1 = oldest, version N = newest
    const index = allVersions.length - versionParam;
    item = allVersions[index];
  } else if (!isNaN(versionParam)) {
    return res.status(404).json({
      error: `Version ${versionParam} not found. Available versions: 1-${allVersions.length}`
    });
  } else {
    item = allVersions[0]; // latest
  }

  res.json({
    content: item.content ?? null,
    data: item.data ?? null,
    type: item.type,
    mimeType: item.mimeType,
    filename: item.filename,
  });
});

// GET /api/sessions/:id/canvas/file/:filename - Get canvas file by filename
// Writes the file to /tmp and returns the file path for Claude's Read tool
// Always returns the latest version
router.get('/:id/canvas/file/:filename', async (req, res) => {
  const { id: sessionId, filename } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get all versions of this file (newest first)
  const allVersions = canvasItems.getAllVersionsByFilename(sessionId, filename);
  if (allVersions.length === 0) {
    return res.status(404).json({ error: 'File not found on canvas' });
  }

  // Always use latest version (index 0)
  const item = allVersions[0];

  try {
    // Create temp directory for this session
    const tempDir = `/tmp/canvas-${sessionId}`;
    await mkdir(tempDir, { recursive: true });

    // Use original filename without version suffix
    const filePath = join(tempDir, filename);

    // Write content based on type
    if (item.type === 'image' || item.type === 'pdf') {
      // Binary: decode base64 and write
      const buffer = Buffer.from(item.data, 'base64');
      await writeFile(filePath, buffer);
    } else if (item.type === 'json') {
      // JSON: write the data field, fallback to content if data is not available
      await writeFile(filePath, item.data || item.content || '{}');
    } else {
      // text/markdown/code: write content field
      await writeFile(filePath, item.content || '');
    }

    // Get file size
    const stats = statSync(filePath);
    const fileSize = stats.size;

    res.json({
      filePath,
      type: item.type,
      mimeType: item.mimeType,
      fileSize,
      createdAt: item.createdAt,
      version: allVersions.length, // Latest version number in standard versioning
      totalVersions: allVersions.length
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to write file: ${err.message}` });
  }
});

// DELETE /api/sessions/:id/canvas/bulk-delete-permanent - Permanently delete multiple items from trash
// NOTE: This must be defined BEFORE /:id/canvas/:itemId to avoid Express matching it as :itemId = "bulk-delete-permanent"
router.delete('/:id/canvas/bulk-delete-permanent', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
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
    return res.status(404).json({ error: 'Session not found' });
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
    return res.status(404).json({ error: 'Session not found' });
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
    return res.status(404).json({ error: 'Session not found' });
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
    return res.status(404).json({ error: 'Session not found' });
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
