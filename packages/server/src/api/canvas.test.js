import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canvasItems, projects } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { existsSync, rmSync } from 'fs';
import { isBinaryContent, getTypeFromExtension } from './canvas.js';

/**
 * Extracts mimeType and base64 data from request body for canvas image items.
 * This logic mirrors what's in the canvas.js route handler.
 */
function parseImageData(body) {
  const { type, content, data, mimeType } = body;

  let extractedMimeType = mimeType || null;
  let extractedData = typeof data === 'object' ? JSON.stringify(data) : data || null;

  if (type === 'image' && content && !data) {
    const dataUrlMatch = content.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      extractedMimeType = dataUrlMatch[1];
      extractedData = dataUrlMatch[2];
    }
  }

  // Ensure image types always have a valid mimeType to prevent broken images in the frontend
  if (type === 'image' && !extractedMimeType) {
    extractedMimeType = 'image/png';
  }

  return { mimeType: extractedMimeType, data: extractedData };
}

describe('Canvas API', () => {
  describe('parseImageData', () => {
    it('returns explicit mimeType and data when provided', () => {
      const result = parseImageData({
        type: 'image',
        mimeType: 'image/png',
        data: 'abc123base64data',
      });

      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBe('abc123base64data');
    });

    it('extracts mimeType and data from data URL in content field', () => {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = parseImageData({
        type: 'image',
        content: `data:image/png;base64,${base64}`,
      });

      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBe(base64);
    });

    it('extracts jpeg mimeType from data URL', () => {
      const base64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBg==';
      const result = parseImageData({
        type: 'image',
        content: `data:image/jpeg;base64,${base64}`,
      });

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.data).toBe(base64);
    });

    it('extracts gif mimeType from data URL', () => {
      const base64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const result = parseImageData({
        type: 'image',
        content: `data:image/gif;base64,${base64}`,
      });

      expect(result.mimeType).toBe('image/gif');
      expect(result.data).toBe(base64);
    });

    it('extracts webp mimeType from data URL', () => {
      const base64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJYgCdAEO';
      const result = parseImageData({
        type: 'image',
        content: `data:image/webp;base64,${base64}`,
      });

      expect(result.mimeType).toBe('image/webp');
      expect(result.data).toBe(base64);
    });

    it('prefers explicit data over content parsing', () => {
      const result = parseImageData({
        type: 'image',
        mimeType: 'image/png',
        data: 'explicitData',
        content: 'data:image/jpeg;base64,contentData',
      });

      // When data is provided, content should not be parsed
      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBe('explicitData');
    });

    it('defaults to image/png mimeType when neither explicit nor parseable', () => {
      const result = parseImageData({
        type: 'image',
        data: 'someBase64Data',
      });

      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBe('someBase64Data');
    });

    it('does not parse content for non-image types', () => {
      const result = parseImageData({
        type: 'markdown',
        content: 'data:image/png;base64,shouldNotParse',
      });

      expect(result.mimeType).toBeNull();
      expect(result.data).toBeNull();
    });

    it('handles malformed data URL gracefully with default mimeType', () => {
      const result = parseImageData({
        type: 'image',
        content: 'not-a-valid-data-url',
      });

      // Should default to image/png for images without parseable mimeType
      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBeNull();
    });

    it('handles data URL without base64 prefix with default mimeType', () => {
      const result = parseImageData({
        type: 'image',
        content: 'data:image/png,notbase64encoded',
      });

      // Should not match since we require ;base64, prefix, but defaults to image/png
      expect(result.mimeType).toBe('image/png');
      expect(result.data).toBeNull();
    });

    it('stringifies object data', () => {
      const result = parseImageData({
        type: 'json',
        data: { key: 'value', nested: { a: 1 } },
      });

      expect(result.data).toBe('{"key":"value","nested":{"a":1}}');
    });
  });

  describe('Canvas Item Creation Integration', () => {
    let sessionId;

    beforeEach(() => {
      // Create a project and session for testing
      const project = projects.create('Test Project', '/tmp/test');
      const now = Date.now();
      const id = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
      sessionId = id;
    });

    it('creates canvas item with explicit mimeType', () => {
      const item = canvasItems.create(sessionId, {
        type: 'image',
        data: 'base64ImageData',
        mimeType: 'image/jpeg',
        label: 'Test Image',
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('base64ImageData');
      expect(item.mimeType).toBe('image/jpeg');
      expect(item.label).toBe('Test Image');
    });

    it('creates canvas item with parsed data URL values', () => {
      // Simulate what the API does: parse then store
      const body = {
        type: 'image',
        content: 'data:image/png;base64,testBase64Data',
        label: 'Parsed Image',
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        content: body.content,
        data: parsed.data,
        mimeType: parsed.mimeType,
        label: body.label,
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('testBase64Data');
      expect(item.mimeType).toBe('image/png');
      expect(item.label).toBe('Parsed Image');
    });

    it('retrieves canvas item with correct mimeType', () => {
      const created = canvasItems.create(sessionId, {
        type: 'image',
        data: 'retrieveTestData',
        mimeType: 'image/gif',
      });

      const retrieved = canvasItems.getById(created.id);

      expect(retrieved.mimeType).toBe('image/gif');
      expect(retrieved.data).toBe('retrieveTestData');
    });

    it('creates canvas item with default mimeType when not provided', () => {
      // Simulate what the API does when mimeType cannot be extracted
      const body = {
        type: 'image',
        data: 'someBase64DataWithoutMimeType',
        label: 'Image without explicit mimeType',
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        data: parsed.data,
        mimeType: parsed.mimeType,
        label: body.label,
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('someBase64DataWithoutMimeType');
      // Should default to image/png to prevent broken images
      expect(item.mimeType).toBe('image/png');
      expect(item.label).toBe('Image without explicit mimeType');
    });

    it('creates canvas item with default mimeType for malformed data URL', () => {
      // Simulate what the API does when content has invalid data URL format
      const body = {
        type: 'image',
        content: 'not-a-valid-data-url',
        label: 'Malformed data URL image',
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        content: body.content,
        data: parsed.data,
        mimeType: parsed.mimeType,
        label: body.label,
      });

      expect(item.type).toBe('image');
      // Should default to image/png to prevent broken images
      expect(item.mimeType).toBe('image/png');
    });

    it('creates PDF canvas item', () => {
      const item = canvasItems.create(sessionId, {
        type: 'pdf',
        data: 'JVBERi0xLjQKJeLjz9MK', // PDF header in base64
        mimeType: 'application/pdf',
        filename: 'document.pdf',
        label: 'Test PDF',
      });

      expect(item.type).toBe('pdf');
      expect(item.data).toBe('JVBERi0xLjQKJeLjz9MK');
      expect(item.mimeType).toBe('application/pdf');
      expect(item.filename).toBe('document.pdf');
    });
  });

  describe('Canvas File Retrieval by Filename', () => {
    let sessionId;
    let tempDir;

    beforeEach(() => {
      // Create a project and session for testing
      const project = projects.create('Test Project', '/tmp/test');
      const now = Date.now();
      const id = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
      sessionId = id;
      tempDir = `/tmp/canvas-${sessionId}`;
    });

    afterEach(() => {
      // Clean up temp directory
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('retrieves all versions of a file by filename', () => {
      // Create multiple versions
      canvasItems.create(sessionId, { type: 'text', content: 'Version 1', filename: 'notes.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 2', filename: 'notes.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 3', filename: 'notes.txt' });

      const versions = canvasItems.getAllVersionsByFilename(sessionId, 'notes.txt');

      expect(versions).toHaveLength(3);
      // All versions should be present
      const contents = versions.map(v => v.content);
      expect(contents).toContain('Version 1');
      expect(contents).toContain('Version 2');
      expect(contents).toContain('Version 3');
    });

    it('returns empty array for non-existent filename', () => {
      const versions = canvasItems.getAllVersionsByFilename(sessionId, 'nonexistent.txt');
      expect(versions).toEqual([]);
    });

    it('returns versions ordered by createdAt descending', () => {
      // Create versions
      canvasItems.create(sessionId, { type: 'markdown', content: '# First', filename: 'doc.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# Second', filename: 'doc.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# Third', filename: 'doc.md' });

      const versions = canvasItems.getAllVersionsByFilename(sessionId, 'doc.md');

      expect(versions).toHaveLength(3);
      // Verify ordering is by createdAt DESC (newest first)
      for (let i = 0; i < versions.length - 1; i++) {
        expect(versions[i].createdAt).toBeGreaterThanOrEqual(versions[i + 1].createdAt);
      }
    });

    it('correctly handles image data for temp file writing', () => {
      // Test that base64 image data can be decoded
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const item = canvasItems.create(sessionId, {
        type: 'image',
        data: base64Image,
        mimeType: 'image/png',
        filename: 'pixel.png',
      });

      // Verify the data can be decoded
      const buffer = Buffer.from(item.data, 'base64');
      expect(buffer.length).toBeGreaterThan(0);
      // PNG magic number
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50); // 'P'
      expect(buffer[2]).toBe(0x4E); // 'N'
      expect(buffer[3]).toBe(0x47); // 'G'
    });

    it('correctly handles PDF data', () => {
      // PDF header: %PDF-1.4
      const pdfBase64 = Buffer.from('%PDF-1.4\n').toString('base64');
      const item = canvasItems.create(sessionId, {
        type: 'pdf',
        data: pdfBase64,
        mimeType: 'application/pdf',
        filename: 'test.pdf',
      });

      // Verify the data can be decoded
      const buffer = Buffer.from(item.data, 'base64');
      const content = buffer.toString('utf-8');
      expect(content).toContain('%PDF');
    });

    it('correctly handles JSON data', () => {
      const jsonData = JSON.stringify({ key: 'value', nested: { a: 1 } });
      const item = canvasItems.create(sessionId, {
        type: 'json',
        data: jsonData,
        filename: 'data.json',
      });

      expect(item.data).toBe(jsonData);
      expect(JSON.parse(item.data)).toEqual({ key: 'value', nested: { a: 1 } });
    });

    it('correctly handles markdown content', () => {
      const item = canvasItems.create(sessionId, {
        type: 'markdown',
        content: '# Heading\n\nParagraph text.',
        filename: 'readme.md',
      });

      expect(item.content).toBe('# Heading\n\nParagraph text.');
      expect(item.type).toBe('markdown');
    });
  });

  describe('isBinaryContent', () => {
    it('returns true for buffer containing null bytes', () => {
      const buffer = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]); // "He\0lo"
      expect(isBinaryContent(buffer)).toBe(true);
    });

    it('returns false for plain text buffer', () => {
      const buffer = Buffer.from('Hello, world!', 'utf-8');
      expect(isBinaryContent(buffer)).toBe(false);
    });

    it('returns false for UTF-8 text with special characters', () => {
      const buffer = Buffer.from('Hello, 世界! 🌍', 'utf-8');
      expect(isBinaryContent(buffer)).toBe(false);
    });

    it('returns true for binary data with null bytes (like PNG image data)', () => {
      // PNG files typically have null bytes in the image data portion
      const pngData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
      expect(isBinaryContent(pngData)).toBe(true);
    });

    it('only checks first 8KB of large buffers', () => {
      const largeText = Buffer.alloc(16384, 0x41); // 16KB of 'A'
      largeText[10000] = 0x00; // Null byte after 8KB mark
      expect(isBinaryContent(largeText)).toBe(false);
    });

    it('returns true for null byte within first 8KB', () => {
      const buffer = Buffer.alloc(10000, 0x41); // 10KB of 'A'
      buffer[5000] = 0x00; // Null byte at 5KB
      expect(isBinaryContent(buffer)).toBe(true);
    });

    it('returns false for empty buffer', () => {
      const buffer = Buffer.alloc(0);
      expect(isBinaryContent(buffer)).toBe(false);
    });
  });

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

    it('returns "json" for json extensions', () => {
      expect(getTypeFromExtension('.json')).toBe('json');
      expect(getTypeFromExtension('.jsonc')).toBe('json');
      expect(getTypeFromExtension('.json5')).toBe('json');
    });

    it('returns "markdown" for markdown extensions', () => {
      expect(getTypeFromExtension('.md')).toBe('markdown');
      expect(getTypeFromExtension('.mdx')).toBe('markdown');
      expect(getTypeFromExtension('.markdown')).toBe('markdown');
    });

    it('returns "code" for code file extensions', () => {
      expect(getTypeFromExtension('.js')).toBe('code');
      expect(getTypeFromExtension('.ts')).toBe('code');
      expect(getTypeFromExtension('.tsx')).toBe('code');
      expect(getTypeFromExtension('.jsx')).toBe('code');
      expect(getTypeFromExtension('.py')).toBe('code');
      expect(getTypeFromExtension('.go')).toBe('code');
      expect(getTypeFromExtension('.rs')).toBe('code');
      expect(getTypeFromExtension('.vue')).toBe('code');
      expect(getTypeFromExtension('.css')).toBe('code');
      expect(getTypeFromExtension('.html')).toBe('code');
      expect(getTypeFromExtension('.sh')).toBe('code');
      expect(getTypeFromExtension('.sql')).toBe('code');
    });

    it('returns "code" for config file extensions', () => {
      expect(getTypeFromExtension('.yaml')).toBe('code');
      expect(getTypeFromExtension('.yml')).toBe('code');
      expect(getTypeFromExtension('.toml')).toBe('code');
      expect(getTypeFromExtension('.xml')).toBe('code');
    });

    it('returns null for unknown extensions', () => {
      expect(getTypeFromExtension('.xyz')).toBe(null);
      expect(getTypeFromExtension('.unknown')).toBe(null);
      expect(getTypeFromExtension('.bin')).toBe(null);
    });
  });

  describe('Code Canvas Item Creation', () => {
    let sessionId;

    beforeEach(() => {
      const project = projects.create('Test Project', '/tmp/test');
      const now = Date.now();
      const id = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
      sessionId = id;
    });

    it('creates code canvas item with content field', () => {
      const item = canvasItems.create(sessionId, {
        type: 'code',
        content: 'function hello() { return "world"; }',
        mimeType: 'text/javascript',
        filename: 'hello.js',
      });

      expect(item.type).toBe('code');
      expect(item.content).toBe('function hello() { return "world"; }');
      expect(item.mimeType).toBe('text/javascript');
      expect(item.filename).toBe('hello.js');
    });

    it('creates code item from TypeScript file', () => {
      const item = canvasItems.create(sessionId, {
        type: 'code',
        content: 'const x: number = 42;',
        mimeType: 'text/typescript',
        filename: 'test.ts',
      });

      expect(item.type).toBe('code');
      expect(item.content).toBe('const x: number = 42;');
    });

    it('creates code item from Python file', () => {
      const item = canvasItems.create(sessionId, {
        type: 'code',
        content: 'def hello():\n    return "world"',
        mimeType: 'text/x-python',
        filename: 'hello.py',
      });

      expect(item.type).toBe('code');
      expect(item.content).toBe('def hello():\n    return "world"');
    });

    it('creates code item with label', () => {
      const item = canvasItems.create(sessionId, {
        type: 'code',
        content: 'package main',
        mimeType: 'text/x-go',
        filename: 'main.go',
        label: 'Go entry point',
      });

      expect(item.type).toBe('code');
      expect(item.label).toBe('Go entry point');
    });

    it('retrieves code canvas item correctly', () => {
      const created = canvasItems.create(sessionId, {
        type: 'code',
        content: 'console.log("test");',
        mimeType: 'text/javascript',
        filename: 'test.js',
      });

      const retrieved = canvasItems.getById(created.id);
      expect(retrieved.type).toBe('code');
      expect(retrieved.content).toBe('console.log("test");');
      expect(retrieved.filename).toBe('test.js');
    });
  });
});
