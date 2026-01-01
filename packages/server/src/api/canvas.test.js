import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { canvasItems, projects } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { existsSync, rmSync } from 'fs';
import { isBinaryContent, getTypeFromExtension } from './canvas.js';
import canvasRouter from './canvas.js';

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
      const jsonObject = { key: 'value', nested: { a: 1 } };
      const item = canvasItems.create(sessionId, {
        type: 'json',
        data: jsonData,
        filename: 'data.json',
      });

      // JSON strings are parsed to objects when retrieved
      expect(item.data).toEqual(jsonObject);
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

  describe('filePath Type Auto-Detection', () => {
    it('auto-detects markdown from .md filePath', () => {
      const result = getTypeFromExtension('.md');
      expect(result).toBe('markdown');
    });

    it('auto-detects JSON from .json filePath', () => {
      const result = getTypeFromExtension('.json');
      expect(result).toBe('json');
    });

    it('auto-detects code from .js filePath', () => {
      const result = getTypeFromExtension('.js');
      expect(result).toBe('code');
    });

    it('auto-detects image from .png filePath', () => {
      const result = getTypeFromExtension('.png');
      expect(result).toBe('image');
    });

    it('auto-detects pdf from .pdf filePath', () => {
      const result = getTypeFromExtension('.pdf');
      expect(result).toBe('pdf');
    });

    it('returns null for unknown extension', () => {
      const result = getTypeFromExtension('.xyz');
      expect(result).toBeNull();
    });
  });

  describe('Inline Canvas Item Creation (No File)', () => {
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

    it('creates text canvas item from inline content', () => {
      const item = canvasItems.create(sessionId, {
        type: 'text',
        content: 'Hello, World!',
        filename: 'output.txt',
        label: 'Command Output',
        mimeType: 'text/plain',
      });

      expect(item.type).toBe('text');
      expect(item.content).toBe('Hello, World!');
      expect(item.filename).toBe('output.txt');
      expect(item.label).toBe('Command Output');
      expect(item.mimeType).toBe('text/plain');
    });

    it('creates markdown canvas item from inline content', () => {
      const item = canvasItems.create(sessionId, {
        type: 'markdown',
        content: '# Heading\n\nParagraph text',
        filename: 'output.md',
        label: 'Markdown Output',
        mimeType: 'text/markdown',
      });

      expect(item.type).toBe('markdown');
      expect(item.content).toBe('# Heading\n\nParagraph text');
      expect(item.filename).toBe('output.md');
      expect(item.mimeType).toBe('text/markdown');
    });

    it('creates code canvas item from inline content', () => {
      const item = canvasItems.create(sessionId, {
        type: 'code',
        content: 'function hello() { console.log("test"); }',
        filename: 'output.js',
        label: 'Code Output',
        mimeType: 'text/plain',
      });

      expect(item.type).toBe('code');
      expect(item.content).toBe('function hello() { console.log("test"); }');
      expect(item.filename).toBe('output.js');
    });

    it('creates JSON canvas item from inline content', () => {
      const jsonString = '{"key": "value", "nested": {"a": 1}}';
      const jsonObject = { key: 'value', nested: { a: 1 } };
      const item = canvasItems.create(sessionId, {
        type: 'json',
        data: jsonString,
        filename: 'output.json',
        label: 'JSON Output',
        mimeType: 'application/json',
      });

      expect(item.type).toBe('json');
      // JSON strings are parsed to objects when retrieved
      expect(item.data).toEqual(jsonObject);
      expect(item.filename).toBe('output.json');
      expect(item.mimeType).toBe('application/json');
    });

    it('creates canvas item without label when not provided', () => {
      const item = canvasItems.create(sessionId, {
        type: 'text',
        content: 'test content',
        filename: 'test.txt',
        mimeType: 'text/plain',
      });

      expect(item.label).toBeNull();
    });

    it('retrieves inline canvas item correctly', () => {
      const created = canvasItems.create(sessionId, {
        type: 'text',
        content: 'Inline test content',
        filename: 'inline-test.txt',
        label: 'Test',
        mimeType: 'text/plain',
      });

      const retrieved = canvasItems.getById(created.id);
      expect(retrieved.type).toBe('text');
      expect(retrieved.content).toBe('Inline test content');
      expect(retrieved.filename).toBe('inline-test.txt');
      expect(retrieved.label).toBe('Test');
    });
  });

  describe('HTTP POST /api/sessions/:id/canvas (Inline Content Mode)', () => {
    let app;
    let projectId;
    let sessionId;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use('/api/sessions', canvasRouter);

      // Create project and session
      const project = projects.create('Test Project', '/tmp/test');
      projectId = project.id;

      const now = Date.now();
      const id = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, projectId, 'Test Session', 'running', 'standard', now, now);
      sessionId = id;
    });

    describe('inline content mode', () => {
      it('creates canvas item from inline text content', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text',
            content: 'Hello, World!',
            filename: 'output.txt',
            label: 'Command Output'
          });

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('text');
        expect(res.body.content).toBe('Hello, World!');
        expect(res.body.filename).toBe('output.txt');
        expect(res.body.label).toBe('Command Output');
        expect(res.body.mimeType).toBe('text/plain');
      });

      it('creates canvas item from inline markdown content', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'markdown',
            content: '# Heading\n\nParagraph text',
            filename: 'output.md',
            label: 'Markdown Output'
          });

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('markdown');
        expect(res.body.content).toBe('# Heading\n\nParagraph text');
        expect(res.body.mimeType).toBe('text/markdown');
      });

      it('creates canvas item from inline code content', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'code',
            content: 'function hello() { return "world"; }',
            filename: 'output.js',
            label: 'Code Output'
          });

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('code');
        expect(res.body.content).toBe('function hello() { return "world"; }');
        expect(res.body.filename).toBe('output.js');
        expect(res.body.mimeType).toBe('text/plain');
      });

      it('creates canvas item from inline JSON content', async () => {
        const jsonContent = '{"key": "value", "nested": {"a": 1}}';
        const jsonObject = { key: 'value', nested: { a: 1 } };
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'json',
            content: jsonContent,
            filename: 'output.json',
            label: 'JSON Output'
          });

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('json');
        // JSON strings are parsed to objects when retrieved
        expect(res.body.data).toEqual(jsonObject);
        expect(res.body.mimeType).toBe('application/json');
      });

      it('rejects inline content with invalid type', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'image',
            content: 'base64data',
            filename: 'output.jpg'
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid type for inline content');
      });

      it('rejects inline content type pdf', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'pdf',
            content: 'pdfcontent',
            filename: 'output.pdf'
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid type for inline content');
      });

      it('includes label in response when provided', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text',
            content: 'Test content',
            filename: 'test.txt',
            label: 'Test Label'
          });

        expect(res.status).toBe(201);
        expect(res.body.label).toBe('Test Label');
      });

      it('sets label to null when not provided', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text',
            content: 'Test content',
            filename: 'test.txt'
          });

        expect(res.status).toBe(201);
        expect(res.body.label).toBeNull();
      });

      it('returns 400 when neither filePath nor inline content provided', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('filePath or');
      });

      it('returns 400 when only type is provided without content and filename', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text'
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('filePath or');
      });
    });

    describe('soft delete (DELETE /:id/canvas/:itemId)', () => {
      it('soft deletes canvas item and returns it with deletedAt', async () => {
        // Create an item first
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text',
            content: 'Delete me',
            filename: 'todelete.txt'
          });

        expect(createRes.status).toBe(201);
        const itemId = createRes.body.id;

        const deleteRes = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/${itemId}`);

        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.deletedAt).toBeDefined();
        expect(typeof deleteRes.body.deletedAt).toBe('number');
        expect(deleteRes.body.id).toBe(itemId);
      });

      it('soft deleted item not returned in GET canvas list', async () => {
        // Create an item
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text',
            content: 'Will be deleted',
            filename: 'hidden.txt'
          });

        const itemId = createRes.body.id;

        // Verify it appears in the list
        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body.some(i => i.id === itemId)).toBe(true);

        // Soft delete
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${itemId}`);

        // Verify it's no longer in the list
        listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body.some(i => i.id === itemId)).toBe(false);
      });

      it('returns 404 for non-existent item', async () => {
        const res = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/nonexistent-id`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
      });
    });

    describe('list trash (GET /:id/canvas-trash)', () => {
      it('returns empty array when trash is empty', async () => {
        const res = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns only deleted items for session', async () => {
        // Create two items
        const item1 = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Active', filename: 'active.txt' });
        const item2 = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Deleted', filename: 'deleted.txt' });

        // Delete one
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${item2.body.id}`);

        const trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        const listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);

        expect(trashRes.status).toBe(200);
        expect(trashRes.body).toHaveLength(1);
        expect(trashRes.body[0].id).toBe(item2.body.id);

        expect(listRes.body).toHaveLength(1);
        expect(listRes.body[0].id).toBe(item1.body.id);
      });

      it('returns 404 for non-existent session', async () => {
        const res = await request(app).get('/api/sessions/nonexistent-session/canvas-trash');

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Session not found');
      });
    });

    describe('recover single item (POST /:id/canvas/:itemId/recover)', () => {
      it('recovers item and returns it without deletedAt', async () => {
        // Create and delete an item
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Recover me', filename: 'recover.txt' });
        const itemId = createRes.body.id;

        await request(app).delete(`/api/sessions/${sessionId}/canvas/${itemId}`);

        const recoverRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas/${itemId}/recover`);

        expect(recoverRes.status).toBe(200);
        expect(recoverRes.body.id).toBe(itemId);
        expect(recoverRes.body.deletedAt).toBeNull();
        expect(recoverRes.body.content).toBe('Recover me');
      });

      it('recovered item appears in canvas list again', async () => {
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Test', filename: 'test.txt' });
        const itemId = createRes.body.id;

        // Delete and verify gone from list
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${itemId}`);
        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body.some(i => i.id === itemId)).toBe(false);

        // Recover
        await request(app).post(`/api/sessions/${sessionId}/canvas/${itemId}/recover`);

        listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body.some(i => i.id === itemId)).toBe(true);
      });

      it('returns 404 for non-existent item', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas/nonexistent-id/recover`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
      });

      it('returns 400 if item is not deleted', async () => {
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Not deleted', filename: 'active.txt' });
        const itemId = createRes.body.id;

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas/${itemId}/recover`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not deleted');
      });
    });

    describe('recover file (POST /:id/canvas-trash/recover-file/:filename)', () => {
      it('recovers all versions of a file', async () => {
        // Create multiple versions
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V1', filename: 'multi.txt' });
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V2', filename: 'multi.txt' });
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V3', filename: 'multi.txt' });

        // Get all items and delete them
        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        for (const item of listRes.body) {
          await request(app).delete(`/api/sessions/${sessionId}/canvas/${item.id}`);
        }

        // Verify trash has 3 items
        let trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        expect(trashRes.body).toHaveLength(3);

        // Recover by filename
        const recoverRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas-trash/recover-file/multi.txt`);

        expect(recoverRes.status).toBe(200);
        expect(recoverRes.body.recovered).toBe(3);

        // Verify all are back in canvas list
        listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body).toHaveLength(3);

        // Verify trash is empty
        trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        expect(trashRes.body).toHaveLength(0);
      });

      it('returns count of recovered items', async () => {
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V1', filename: 'count.txt' });
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V2', filename: 'count.txt' });

        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        for (const item of listRes.body) {
          await request(app).delete(`/api/sessions/${sessionId}/canvas/${item.id}`);
        }

        const recoverRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas-trash/recover-file/count.txt`);

        expect(recoverRes.body).toHaveProperty('recovered');
        expect(recoverRes.body.recovered).toBe(2);
      });

      it('returns 404 for non-existent session', async () => {
        const res = await request(app)
          .post('/api/sessions/nonexistent-session/canvas-trash/recover-file/test.txt');

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Session not found');
      });
    });

    describe('permanent delete (DELETE /:id/canvas/:itemId/permanent)', () => {
      it('permanently deletes item from database', async () => {
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Gone forever', filename: 'perm.txt' });
        const itemId = createRes.body.id;

        // Soft delete first
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${itemId}`);

        // Permanent delete
        const permRes = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/${itemId}/permanent`);

        expect(permRes.status).toBe(204);

        // Verify not in trash
        const trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        expect(trashRes.body.some(i => i.id === itemId)).toBe(false);

        // Verify not in canvas
        const listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body.some(i => i.id === itemId)).toBe(false);
      });

      it('returns 404 for non-existent item', async () => {
        const res = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/nonexistent-id/permanent`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('not found');
      });

      it('returns 400 if item is not in trash', async () => {
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Active item', filename: 'active.txt' });
        const itemId = createRes.body.id;

        const res = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/${itemId}/permanent`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('must be in trash');
      });

      it('returns 204 on success with no content', async () => {
        const createRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Test', filename: 'nocontent.txt' });
        const itemId = createRes.body.id;

        await request(app).delete(`/api/sessions/${sessionId}/canvas/${itemId}`);

        const res = await request(app)
          .delete(`/api/sessions/${sessionId}/canvas/${itemId}/permanent`);

        expect(res.status).toBe(204);
        expect(res.text).toBe('');
      });
    });

    describe('error handling continued', () => {
      it('prefers filePath mode when both filePath and inline content provided', async () => {
        // Create a temporary file
        const { writeFileSync } = await import('fs');
        const tempFile = '/tmp/test-canvas-file.txt';
        writeFileSync(tempFile, 'File content');

        try {
          const res = await request(app)
            .post(`/api/sessions/${sessionId}/canvas`)
            .send({
              filePath: tempFile,
              type: 'text',
              content: 'Should be ignored',
              filename: 'should-be-ignored.txt'
            });

          expect(res.status).toBe(201);
          expect(res.body.content).toBe('File content');
          expect(res.body.filename).toContain('test-canvas-file');
        } finally {
          rmSync(tempFile, { force: true });
        }
      });

      it('creates retrievable canvas item from inline content', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'markdown',
            content: '# Test\n\nMarkdown content',
            filename: 'test.md',
            label: 'Test Markdown'
          });

        expect(res.status).toBe(201);
        const itemId = res.body.id;

        // Verify the item was stored and can be retrieved
        const retrieved = canvasItems.getById(itemId);
        expect(retrieved).toBeDefined();
        expect(retrieved.type).toBe('markdown');
        expect(retrieved.content).toBe('# Test\n\nMarkdown content');
      });
    });

    describe('error handling', () => {
      it('returns 404 for non-existent session', async () => {
        const res = await request(app)
          .post('/api/sessions/nonexistent-id/canvas')
          .send({
            type: 'text',
            content: 'Test',
            filename: 'test.txt'
          });

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Session not found');
      });
    });
  });
});
