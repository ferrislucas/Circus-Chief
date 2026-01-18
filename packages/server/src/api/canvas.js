import { Router } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join, basename } from 'path';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { upload, handleUploadError } from '../middleware/upload.js';

const router = Router();

// Map file extensions to MIME types for binary files (images/PDF)
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

// Text-based file extensions mapped to MIME types
const TEXT_EXTENSIONS = {
  // Code files
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.mts': 'text/typescript',
  '.cts': 'text/typescript',
  '.jsx': 'text/javascript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  // Config/data files
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/x-toml',
  '.xml': 'text/xml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.env': 'text/plain',
  '.properties': 'text/plain',
  // Special files
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
  '.editorconfig': 'text/plain',
  '.prettierrc': 'text/plain',
  '.eslintrc': 'text/plain',
  // Markdown
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.markdown': 'text/markdown',
  // Plain text
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  // JSON
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.json5': 'application/json',
};

/**
 * Check if a buffer contains binary content by looking for null bytes
 * @param {Buffer} buffer - The buffer to check
 * @returns {boolean} True if binary content detected
 */
export function isBinaryContent(buffer) {
  // Check first 8KB for null bytes (common indicator of binary content)
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Determine canvas type from file extension
 * @param {string} ext - The file extension (with leading dot)
 * @returns {string|null} The canvas type or null if unknown
 */
export function getTypeFromExtension(ext) {
  if (MIME_TYPES[ext]) {
    return ext === '.pdf' ? 'pdf' : 'image';
  }
  if (ext === '.json' || ext === '.jsonc' || ext === '.json5') {
    return 'json';
  }
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') {
    return 'markdown';
  }
  if (TEXT_EXTENSIONS[ext]) {
    return 'code';
  }
  return null; // Unknown, will try binary detection
}

/**
 * Get MIME type for a canvas type
 * @param {string} type - The canvas type (text, markdown, code, json)
 * @returns {string} The MIME type
 */
function getMimeTypeForType(type) {
  switch (type) {
    case 'text':
      return 'text/plain';
    case 'markdown':
      return 'text/markdown';
    case 'code':
      return 'text/plain';
    case 'json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

// POST /api/sessions/:id/canvas - Add canvas item
// Supports three modes:
// 1. Multipart mode: FormData with 'file' field - from browser file uploads
// 2. File mode: { filePath, label? } - reads file from disk
// 3. Inline mode: { type, content, filename, label? } - uses provided content directly
router.post('/:id/canvas', upload.single('file'), handleUploadError, (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { filePath, label, type, content, filename } = req.body;
  let itemData;

  // Mode 1: Multipart file upload from FormData
  if (req.file) {
    const fileBuffer = req.file.buffer;
    const filename = req.file.originalname;
    const ext = extname(filename).toLowerCase();
    let detectedType = getTypeFromExtension(ext);
    let detectedMimeType = MIME_TYPES[ext] || TEXT_EXTENSIONS[ext];

    // For unknown extensions, detect if binary or text
    if (!detectedType) {
      if (isBinaryContent(fileBuffer)) {
        return res.status(400).json({
          error: `Unsupported binary file format: ${ext}. Supported binary formats: ${Object.keys(MIME_TYPES).join(', ')}`
        });
      }
      // It's a text file with unknown extension, treat as code
      detectedType = 'code';
      detectedMimeType = 'text/plain';
    }

    // Handle binary types (image, pdf)
    if (detectedType === 'image' || detectedType === 'pdf') {
      const base64 = fileBuffer.toString('base64');
      itemData = {
        type: detectedType,
        data: base64,
        mimeType: detectedMimeType,
        filename: filename,
        label: req.body.label || null,
      };
    } else {
      // Handle text-based types (code, markdown, json)
      const textContent = fileBuffer.toString('utf-8');
      itemData = {
        type: detectedType,
        content: detectedType === 'json' ? null : textContent,
        data: detectedType === 'json' ? textContent : null,
        mimeType: detectedMimeType,
        filename: filename,
        label: req.body.label || null,
      };
    }
  }
  // Mode 2: File path provided - read from disk
  else if (filePath) {
    if (!existsSync(filePath)) {
      return res.status(400).json({ error: `File not found: ${filePath}` });
    }

    try {
      const fileBuffer = readFileSync(filePath);
      const ext = extname(filePath).toLowerCase();
      let detectedType = getTypeFromExtension(ext);
      let detectedMimeType = MIME_TYPES[ext] || TEXT_EXTENSIONS[ext];

      // For unknown extensions, detect if binary or text
      if (!detectedType) {
        if (isBinaryContent(fileBuffer)) {
          return res.status(400).json({
            error: `Unsupported binary file format: ${ext}. Supported binary formats: ${Object.keys(MIME_TYPES).join(', ')}`
          });
        }
        // It's a text file with unknown extension, treat as code
        detectedType = 'code';
        detectedMimeType = 'text/plain';
      }

      // Handle binary types (image, pdf)
      if (detectedType === 'image' || detectedType === 'pdf') {
        const base64 = fileBuffer.toString('base64');
        itemData = {
          type: detectedType,
          data: base64,
          mimeType: detectedMimeType,
          filename: basename(filePath),
          label: label || null,
        };
      } else {
        // Handle text-based types (code, markdown, json)
        const textContent = fileBuffer.toString('utf-8');
        itemData = {
          type: detectedType,
          content: detectedType === 'json' ? null : textContent,
          data: detectedType === 'json' ? textContent : null,
          mimeType: detectedMimeType,
          filename: basename(filePath),
          label: label || null,
        };
      }
    } catch (err) {
      return res.status(400).json({ error: `Failed to read file: ${err.message}` });
    }
  }
  // Mode 3: Inline content provided - use directly
  else if (content !== undefined && type && filename) {
    // Validate type is text-based (not image/pdf which require binary)
    const validInlineTypes = ['text', 'markdown', 'code', 'json'];
    if (!validInlineTypes.includes(type)) {
      return res.status(400).json({
        error: `Invalid type for inline content: ${type}. Valid types: ${validInlineTypes.join(', ')}`
      });
    }

    // Create canvas item from inline content
    itemData = {
      type,
      content: type === 'json' ? null : content,
      data: type === 'json' ? content : null,
      mimeType: getMimeTypeForType(type),
      filename,
      label: label || null,
    };
  }
  // No valid mode provided
  else {
    return res.status(400).json({
      error: 'Either file upload, filePath, or (type + content + filename) is required'
    });
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
  res.json(items);
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

  const deletedCount = canvasItems.softDeleteBatch(itemIds);

  // Broadcast each deleted item to session subscribers
  itemIds.forEach(itemId => {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId });
  });

  res.json({ deletedCount });
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

  const recoveredCount = canvasItems.recoverBatch(itemIds);

  // Broadcast each recovered item to session subscribers
  itemIds.forEach(itemId => {
    const item = canvasItems.getById(itemId);
    if (item) {
      broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
    }
  });

  res.json({ recoveredCount });
});

// DELETE /api/sessions/:id/canvas/bulk-delete-permanent - Permanently delete multiple items from trash
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

  const deletedCount = canvasItems.permanentDeleteBatch(itemIds);

  // Broadcast each deleted item to session subscribers
  itemIds.forEach(itemId => {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId });
  });

  res.json({ deletedCount });
});

export default router;
