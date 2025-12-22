import { Router } from 'express';
import multer from 'multer';
import { readFileSync, existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join, basename } from 'path';
import { sessions, canvasItems } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Map file extensions to MIME types
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
    const { type, content, data, label, title, width, height, mimeType, filePath } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'Type is required' });
    }

    // Handle image or PDF from file path
    if ((type === 'image' || type === 'pdf') && filePath) {
      if (!existsSync(filePath)) {
        return res.status(400).json({ error: `File not found: ${filePath}` });
      }

      const ext = extname(filePath).toLowerCase();
      const detectedMimeType = MIME_TYPES[ext];
      if (!detectedMimeType) {
        return res.status(400).json({
          error: `Unsupported file format: ${ext}. Supported formats: ${Object.keys(MIME_TYPES).join(', ')}`
        });
      }

      // Determine actual type from extension (pdf vs image)
      const actualType = ext === '.pdf' ? 'pdf' : 'image';

      try {
        const fileBuffer = readFileSync(filePath);
        const base64 = fileBuffer.toString('base64');
        itemData = {
          type: actualType,
          data: base64,
          mimeType: detectedMimeType,
          filename: filePath.split('/').pop(),
          label: label || title || null,
          width: width || null,
          height: height || null,
        };
      } catch (err) {
        return res.status(400).json({ error: `Failed to read file: ${err.message}` });
      }
    } else {
      // Handle data URL format: extract mimeType and base64 data from "data:image/jpeg;base64,..."
      let extractedMimeType = mimeType || null;
      let extractedData = typeof data === 'object' ? JSON.stringify(data) : data || null;

      if (type === 'image' && content && !data) {
        const dataUrlMatch = content.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          extractedMimeType = dataUrlMatch[1];
          extractedData = dataUrlMatch[2];
        }
      }

      // Validate image has required data
      if (type === 'image' && !extractedData && !extractedMimeType) {
        return res.status(400).json({
          error: 'Image requires either: filePath, data+mimeType, or content as data URL (data:image/...;base64,...)'
        });
      }

      // Ensure image types always have a valid mimeType to prevent broken images in the frontend
      if (type === 'image' && !extractedMimeType) {
        extractedMimeType = 'image/png';
      }

      itemData = {
        type,
        content: content || null,
        data: extractedData,
        mimeType: extractedMimeType,
        label: label || title || null, // Support both 'label' and 'title' fields
        width: width || null,
        height: height || null,
      };
    }
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

// GET /api/sessions/:id/canvas/file/:filename - Get canvas file by filename
// Writes the file to /tmp and returns the file path for Claude's Read tool
router.get('/:id/canvas/file/:filename', async (req, res) => {
  const { id: sessionId, filename } = req.params;
  const version = req.query.version ? parseInt(req.query.version, 10) : null;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get all versions of this file (newest first)
  const allVersions = canvasItems.getAllVersionsByFilename(sessionId, filename);
  if (allVersions.length === 0) {
    return res.status(404).json({ error: 'File not found on canvas' });
  }

  // Select version: null = latest (index 0), 1 = latest, 2 = second latest, etc.
  const versionIndex = version ? version - 1 : 0;
  if (versionIndex < 0 || versionIndex >= allVersions.length) {
    return res.status(404).json({
      error: `Version ${version} not found. Available versions: 1-${allVersions.length}`
    });
  }
  const item = allVersions[versionIndex];

  try {
    // Create temp directory for this session
    const tempDir = `/tmp/canvas-${sessionId}`;
    await mkdir(tempDir, { recursive: true });

    // Include version in filename to avoid collisions when viewing multiple versions
    const versionSuffix = version && version > 1 ? `.v${version}` : '';
    const ext = extname(filename);
    const base = basename(filename, ext);
    const tempFilename = `${base}${versionSuffix}${ext}`;
    const filePath = join(tempDir, tempFilename);

    // Write content based on type
    if (item.type === 'image' || item.type === 'pdf') {
      // Binary: decode base64 and write
      const buffer = Buffer.from(item.data, 'base64');
      await writeFile(filePath, buffer);
    } else if (item.type === 'json') {
      // JSON: write the data field
      await writeFile(filePath, item.data || '{}');
    } else {
      // text/markdown: write content field
      await writeFile(filePath, item.content || '');
    }

    res.json({
      filePath,
      type: item.type,
      mimeType: item.mimeType,
      createdAt: item.createdAt,
      version: versionIndex + 1,
      totalVersions: allVersions.length
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to write file: ${err.message}` });
  }
});

// DELETE /api/sessions/:id/canvas/:itemId - Delete canvas item
router.delete('/:id/canvas/:itemId', (req, res) => {
  const item = canvasItems.getById(req.params.itemId);
  if (!item || item.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Canvas item not found' });
  }

  canvasItems.delete(req.params.itemId);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CANVAS_REMOVE, { sessionId: req.params.id, itemId: req.params.itemId });

  res.status(204).send();
});

export default router;
