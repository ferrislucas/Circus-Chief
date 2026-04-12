import { extname } from 'path';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// Common MIME type constants
const MIME_TEXT_PLAIN = 'text/plain';
const MIME_TEXT_MARKDOWN = 'text/markdown';

// Map file extensions to MIME types for binary files (images/PDF)
export const MIME_TYPES = {
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
export const TEXT_EXTENSIONS = {
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
  '.ini': MIME_TEXT_PLAIN,
  '.cfg': MIME_TEXT_PLAIN,
  '.conf': MIME_TEXT_PLAIN,
  '.env': MIME_TEXT_PLAIN,
  '.properties': MIME_TEXT_PLAIN,
  // Special files
  '.gitignore': MIME_TEXT_PLAIN,
  '.dockerignore': MIME_TEXT_PLAIN,
  '.editorconfig': MIME_TEXT_PLAIN,
  '.prettierrc': MIME_TEXT_PLAIN,
  '.eslintrc': MIME_TEXT_PLAIN,
  // Markdown
  '.md': MIME_TEXT_MARKDOWN,
  '.mdx': MIME_TEXT_MARKDOWN,
  '.markdown': MIME_TEXT_MARKDOWN,
  // Plain text
  '.txt': MIME_TEXT_PLAIN,
  '.log': MIME_TEXT_PLAIN,
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
      return MIME_TEXT_PLAIN;
    case 'markdown':
      return MIME_TEXT_MARKDOWN;
    case 'code':
      return MIME_TEXT_PLAIN;
    case 'json':
      return 'application/json';
    default:
      return MIME_TEXT_PLAIN;
  }
}

/**
 * Process a file buffer and build canvas item data.
 * Handles type detection, binary vs text classification, and data encoding.
 * @param {Buffer} fileBuffer - The file contents as a buffer
 * @param {string} itemFilename - The filename for the canvas item
 * @returns {{ error: string } | { itemData: object }} Result with either error or itemData
 */
export function processFileBuffer(fileBuffer, itemFilename) {
  const ext = extname(itemFilename).toLowerCase();
  let detectedType = getTypeFromExtension(ext);
  let detectedMimeType = MIME_TYPES[ext] || TEXT_EXTENSIONS[ext];

  // For unknown extensions, detect if binary or text
  if (!detectedType) {
    if (isBinaryContent(fileBuffer)) {
      return {
        error: `Unsupported binary file format: ${ext}. Supported binary formats: ${Object.keys(MIME_TYPES).join(', ')}`
      };
    }
    // It's a text file with unknown extension, treat as code
    detectedType = 'code';
    detectedMimeType = MIME_TEXT_PLAIN;
  }

  // Handle binary types (image, pdf)
  if (detectedType === 'image' || detectedType === 'pdf') {
    const base64 = fileBuffer.toString('base64');
    return {
      itemData: {
        type: detectedType,
        data: base64,
        mimeType: detectedMimeType,
        filename: itemFilename,
      }
    };
  }

  // Handle text-based types (code, markdown, json)
  const textContent = fileBuffer.toString('utf-8');
  return {
    itemData: {
      type: detectedType,
      content: detectedType === 'json' ? null : textContent,
      data: detectedType === 'json' ? textContent : null,
      mimeType: detectedMimeType,
      filename: itemFilename,
    }
  };
}

export const VALID_INLINE_TYPES = ['text', 'markdown', 'code', 'json'];

/**
 * Validate that the given type is valid for inline canvas content.
 * @param {string} type - The canvas type to validate
 * @returns {string|null} Error message if invalid, null if valid
 */
export function validateInlineType(type) {
  if (!VALID_INLINE_TYPES.includes(type)) {
    return `Invalid type for inline content: ${type}. Valid types: ${VALID_INLINE_TYPES.join(', ')}`;
  }
  return null;
}

/**
 * Build canvas item data from inline content.
 * @param {string} type - The canvas type
 * @param {string} content - The content string
 * @param {string} itemFilename - The filename
 * @returns {object} The canvas item data
 */
export function buildInlineItemData(type, content, itemFilename) {
  return {
    type,
    content: type === 'json' ? null : content,
    data: type === 'json' ? content : null,
    mimeType: getMimeTypeForType(type),
    filename: itemFilename,
  };
}

/**
 * Broadcast a canvas update to all session subscribers.
 * @param {string} sessionId - The session ID
 * @param {object} item - The canvas item to broadcast
 */
export function broadcastCanvasUpdate(sessionId, item) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.CANVAS_ADD, { item });
}

/**
 * Write a canvas item to a file based on its type.
 * @param {Object} item - The canvas item
 * @param {string} filePath - The file path to write to
 */
export async function writeCanvasItemToFile(item, filePath) {
  const { writeFile } = await import('fs/promises');
  if (item.type === 'image' || item.type === 'pdf') {
    const buffer = Buffer.from(item.data, 'base64');
    await writeFile(filePath, buffer);
  } else if (item.type === 'json') {
    await writeFile(filePath, item.data || item.content || '{}');
  } else {
    await writeFile(filePath, item.content || '');
  }
}
