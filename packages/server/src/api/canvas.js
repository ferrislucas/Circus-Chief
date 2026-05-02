import { Router } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { mkdir } from 'fs/promises';
import { extname, join, basename } from 'path';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, UpdateCanvasItemRequest } from '@circuschief/shared';
import { upload, handleUploadError } from '../middleware/upload.js';
import {
  isBinaryContent,
  getTypeFromExtension,
  processFileBuffer,
  VALID_INLINE_TYPES,
  validateInlineType,
  buildInlineItemData,
  broadcastCanvasUpdate,
  writeCanvasItemToFile,
} from './canvas-helpers.js';
import trashRoutes from './canvas-trash-routes.js';

// Error message constants
const ERR_SESSION_NOT_FOUND = 'Session not found';

/**
 * Process multipart file upload (Mode 1)
 * @param {Express.Multer.File} file - The uploaded file from multer
 * @returns {{ itemData: Object } | { error: string }}
 */
function handleMultipartUpload(file) {
  const result = processFileBuffer(file.buffer, file.originalname);
  if (result.error) {
    return { error: result.error };
  }
  return { itemData: result.itemData };
}

/**
 * Process file path upload (Mode 2) - reads file from disk
 * @param {string} filePath - Path to the file on disk
 * @returns {{ itemData: Object } | { error: string }}
 */
function handleFilePathUpload(filePath) {
  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const fileBuffer = readFileSync(filePath);
    const result = processFileBuffer(fileBuffer, basename(filePath));
    if (result.error) {
      return { error: result.error };
    }
    return { itemData: result.itemData };
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` };
  }
}

/**
 * Process inline content upload (Mode 3)
 * @param {string} type - The content type
 * @param {string} content - The content data
 * @param {string} filename - The filename
 * @returns {{ itemData: Object } | { error: string }}
 */
function handleInlineUpload(type, content, filename) {
  const validationError = validateInlineType(type);
  if (validationError) {
    return { error: validationError };
  }
  return { itemData: buildInlineItemData(type, content, filename) };
}

// Re-export for tests
export { isBinaryContent, getTypeFromExtension };

const router = Router();

// Mount trash and bulk operation routes
router.use('/', trashRoutes);

// POST /api/sessions/:id/canvas - Add canvas item
// Supports three modes:
// 1. Multipart mode: FormData with 'file' field - from browser file uploads
// 2. File mode: { filePath } - reads file from disk
// 3. Inline mode: { type, content, filename } - uses provided content directly
router.post('/:id/canvas', upload.single('file'), handleUploadError, (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const { filePath, type, content, filename } = req.body;
  let result;

  // Determine upload mode and process accordingly
  if (req.file) {
    result = handleMultipartUpload(req.file);
  } else if (filePath) {
    result = handleFilePathUpload(filePath);
  } else if (content !== undefined && type && filename) {
    result = handleInlineUpload(type, content, filename);
  } else {
    return res.status(400).json({
      error: 'Either file upload, filePath, or (type + content + filename) is required'
    });
  }

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const item = canvasItems.create(req.params.id, result.itemData);

  // Broadcast to session subscribers
  broadcastCanvasUpdate(req.params.id, item);

  res.status(201).json(item);
});

// PUT /api/sessions/:id/canvas/:itemId - Update canvas item content in-place
router.put('/:id/canvas/:itemId', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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
    await writeCanvasItemToFile(item, filePath);

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
  if (!session) return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });

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

// GET /api/sessions/:id/canvas/:itemId/content - Get one canvas item content inline
router.get('/:id/canvas/:itemId/content', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });

  const item = canvasItems.getById(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Canvas item not found' });
  if (item.sessionId !== req.params.id) {
    return res.status(400).json({ error: 'Canvas item does not belong to this session' });
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
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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
    await writeCanvasItemToFile(item, filePath);

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

export default router;
