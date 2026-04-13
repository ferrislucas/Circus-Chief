import { describe, it, expect, vi } from 'vitest';
import {
  isBinaryContent,
  getTypeFromExtension,
  processFileBuffer,
  VALID_INLINE_TYPES,
  validateInlineType,
  buildInlineItemData,
  broadcastCanvasUpdate,
} from './canvas-helpers.js';

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

vi.mock('@circuschief/shared', () => ({
  WS_MESSAGE_TYPES: { CANVAS_ADD: 'canvas_add' },
}));

// ── isBinaryContent ──────────────────────────────────────────────────────

describe('isBinaryContent', () => {
  it('returns true for a buffer containing a null byte', () => {
    const buf = Buffer.from([65, 66, 0, 67]);
    expect(isBinaryContent(buf)).toBe(true);
  });

  it('returns false for a buffer without null bytes', () => {
    const buf = Buffer.from('hello world');
    expect(isBinaryContent(buf)).toBe(false);
  });

  it('returns false for an empty buffer', () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
  });

  it('only checks the first 8KB', () => {
    const buf = Buffer.alloc(9000, 65);
    buf[9000 - 1] = 0;
    expect(isBinaryContent(buf)).toBe(false);
  });

  it('detects null byte within the first 8KB', () => {
    const buf = Buffer.alloc(9000, 65);
    buf[8000] = 0;
    expect(isBinaryContent(buf)).toBe(true);
  });
});

// ── getTypeFromExtension ─────────────────────────────────────────────────

describe('getTypeFromExtension', () => {
  it('returns "image" for image extensions', () => {
    expect(getTypeFromExtension('.png')).toBe('image');
    expect(getTypeFromExtension('.jpg')).toBe('image');
    expect(getTypeFromExtension('.jpeg')).toBe('image');
    expect(getTypeFromExtension('.gif')).toBe('image');
    expect(getTypeFromExtension('.webp')).toBe('image');
    expect(getTypeFromExtension('.svg')).toBe('image');
    expect(getTypeFromExtension('.bmp')).toBe('image');
    expect(getTypeFromExtension('.ico')).toBe('image');
  });

  it('returns "pdf" for .pdf extension', () => {
    expect(getTypeFromExtension('.pdf')).toBe('pdf');
  });

  it('returns "json" for JSON extensions', () => {
    expect(getTypeFromExtension('.json')).toBe('json');
    expect(getTypeFromExtension('.jsonc')).toBe('json');
    expect(getTypeFromExtension('.json5')).toBe('json');
  });

  it('returns "markdown" for markdown extensions', () => {
    expect(getTypeFromExtension('.md')).toBe('markdown');
    expect(getTypeFromExtension('.mdx')).toBe('markdown');
    expect(getTypeFromExtension('.markdown')).toBe('markdown');
  });

  it('returns "code" for other known text extensions', () => {
    expect(getTypeFromExtension('.js')).toBe('code');
    expect(getTypeFromExtension('.ts')).toBe('code');
    expect(getTypeFromExtension('.py')).toBe('code');
    expect(getTypeFromExtension('.html')).toBe('code');
    expect(getTypeFromExtension('.css')).toBe('code');
    expect(getTypeFromExtension('.yaml')).toBe('code');
    expect(getTypeFromExtension('.sh')).toBe('code');
  });

  it('returns null for unknown extensions', () => {
    expect(getTypeFromExtension('.xyz')).toBeNull();
    expect(getTypeFromExtension('.abc')).toBeNull();
  });
});

// ── processFileBuffer ────────────────────────────────────────────────────

describe('processFileBuffer', () => {
  it('processes a binary image file (returns base64 itemData)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
    const result = processFileBuffer(buf, 'photo.png');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('image');
    expect(result.itemData.data).toBe(buf.toString('base64'));
    expect(result.itemData.mimeType).toBe('image/png');
    expect(result.itemData.filename).toBe('photo.png');
  });

  it('processes a PDF file (returns base64 itemData)', () => {
    const buf = Buffer.from('%PDF-1.4');
    const result = processFileBuffer(buf, 'document.pdf');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('pdf');
    expect(result.itemData.data).toBe(buf.toString('base64'));
    expect(result.itemData.mimeType).toBe('application/pdf');
  });

  it('processes a text code file (returns content)', () => {
    const buf = Buffer.from('console.log("hello");');
    const result = processFileBuffer(buf, 'index.js');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('code');
    expect(result.itemData.content).toBe('console.log("hello");');
    expect(result.itemData.data).toBeNull();
    expect(result.itemData.mimeType).toBe('text/javascript');
  });

  it('processes a JSON file (sets data field, content null)', () => {
    const buf = Buffer.from('{"key": "value"}');
    const result = processFileBuffer(buf, 'data.json');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('json');
    expect(result.itemData.content).toBeNull();
    expect(result.itemData.data).toBe('{"key": "value"}');
    expect(result.itemData.mimeType).toBe('application/json');
  });

  it('processes a markdown file', () => {
    const buf = Buffer.from('# Hello World');
    const result = processFileBuffer(buf, 'readme.md');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('markdown');
    expect(result.itemData.content).toBe('# Hello World');
    expect(result.itemData.data).toBeNull();
  });

  it('returns error for unknown binary extension', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02]); // binary content
    const result = processFileBuffer(buf, 'file.xyz');
    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Unsupported binary file format');
    expect(result.error).toContain('.xyz');
  });

  it('treats unknown text extension as code', () => {
    const buf = Buffer.from('some text content');
    const result = processFileBuffer(buf, 'file.unknownext');
    expect(result).toHaveProperty('itemData');
    expect(result.itemData.type).toBe('code');
    expect(result.itemData.mimeType).toBe('text/plain');
  });
});

// ── VALID_INLINE_TYPES ───────────────────────────────────────────────────

describe('VALID_INLINE_TYPES', () => {
  it('exports the expected array', () => {
    expect(VALID_INLINE_TYPES).toEqual(['text', 'markdown', 'code', 'json']);
  });
});

// ── validateInlineType ───────────────────────────────────────────────────

describe('validateInlineType', () => {
  it('returns null for valid types', () => {
    expect(validateInlineType('text')).toBeNull();
    expect(validateInlineType('markdown')).toBeNull();
    expect(validateInlineType('code')).toBeNull();
    expect(validateInlineType('json')).toBeNull();
  });

  it('returns error message for invalid types', () => {
    const result = validateInlineType('image');
    expect(result).toContain('Invalid type for inline content');
    expect(result).toContain('image');
  });
});

// ── buildInlineItemData ──────────────────────────────────────────────────

describe('buildInlineItemData', () => {
  it('builds text item with content field', () => {
    const data = buildInlineItemData('text', 'hello', 'note.txt');
    expect(data).toEqual({
      type: 'text',
      content: 'hello',
      data: null,
      mimeType: 'text/plain',
      filename: 'note.txt',
    });
  });

  it('builds markdown item with content field', () => {
    const data = buildInlineItemData('markdown', '# Title', 'doc.md');
    expect(data).toEqual({
      type: 'markdown',
      content: '# Title',
      data: null,
      mimeType: 'text/markdown',
      filename: 'doc.md',
    });
  });

  it('builds code item with content field', () => {
    const data = buildInlineItemData('code', 'x = 1', 'app.py');
    expect(data).toEqual({
      type: 'code',
      content: 'x = 1',
      data: null,
      mimeType: 'text/plain',
      filename: 'app.py',
    });
  });

  it('builds json item with data field and null content', () => {
    const data = buildInlineItemData('json', '{"a":1}', 'data.json');
    expect(data).toEqual({
      type: 'json',
      content: null,
      data: '{"a":1}',
      mimeType: 'application/json',
      filename: 'data.json',
    });
  });
});

// ── broadcastCanvasUpdate ────────────────────────────────────────────────

describe('broadcastCanvasUpdate', () => {
  it('calls broadcastToSession with correct arguments', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    const item = { id: 'item-1', type: 'text', content: 'hello' };
    broadcastCanvasUpdate('session-123', item);
    expect(broadcastToSession).toHaveBeenCalledWith('session-123', 'canvas_add', { item });
  });
});
