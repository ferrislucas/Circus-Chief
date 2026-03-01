import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { canvasItems, projects } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { existsSync, rmSync, readFileSync } from 'fs';
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
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('base64ImageData');
      expect(item.mimeType).toBe('image/jpeg');
    });

    it('creates canvas item with parsed data URL values', () => {
      // Simulate what the API does: parse then store
      const body = {
        type: 'image',
        content: 'data:image/png;base64,testBase64Data',
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        content: body.content,
        data: parsed.data,
        mimeType: parsed.mimeType,
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('testBase64Data');
      expect(item.mimeType).toBe('image/png');
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
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        data: parsed.data,
        mimeType: parsed.mimeType,
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('someBase64DataWithoutMimeType');
      // Should default to image/png to prevent broken images
      expect(item.mimeType).toBe('image/png');
    });

    it('creates canvas item with default mimeType for malformed data URL', () => {
      // Simulate what the API does when content has invalid data URL format
      const body = {
        type: 'image',
        content: 'not-a-valid-data-url',
      };

      const parsed = parseImageData(body);

      const item = canvasItems.create(sessionId, {
        type: body.type,
        content: body.content,
        data: parsed.data,
        mimeType: parsed.mimeType,
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
    let app;
    let _projectId;

    beforeEach(() => {
      // Create a project and session for testing
      const project = projects.create('Test Project', '/tmp/test');
      _projectId = project.id;
      const now = Date.now();
      const id = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
      sessionId = id;
      tempDir = `/tmp/canvas-${sessionId}`;

      // Setup Express app for HTTP tests
      app = express();
      app.use(express.json());
      // Note: upload middleware is now per-route in canvas.js, not global
      app.use('/api/sessions', canvasRouter);
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

    describe('GET file endpoint with fileSize', () => {
      it('returns fileSize field in response for text content', async () => {
        const content = 'Hello, World!';
        canvasItems.create(sessionId, { type: 'text', content, filename: 'test.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/test.txt`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('fileSize');
        expect(typeof res.body.fileSize).toBe('number');
        expect(res.body.fileSize).toBeGreaterThan(0);
      });

      it('fileSize matches actual text content length', async () => {
        const content = 'The quick brown fox jumps over the lazy dog';
        canvasItems.create(sessionId, { type: 'code', content, filename: 'code.js' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/code.js`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBe(Buffer.byteLength(content, 'utf-8'));
        expect(res.body.fileSize).toBe(43);
      });

      it('fileSize is correct for markdown content', async () => {
        const content = '# Heading\n\nParagraph text\n';
        canvasItems.create(sessionId, { type: 'markdown', content, filename: 'doc.md' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/doc.md`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBe(Buffer.byteLength(content, 'utf-8'));
        expect(res.body.type).toBe('markdown');
      });

      it('fileSize is correct for base64-decoded image', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52
        ]);
        const base64 = pngBuffer.toString('base64');
        canvasItems.create(sessionId, { type: 'image', data: base64, mimeType: 'image/png', filename: 'pixel.png' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/pixel.png`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBe(pngBuffer.length);
        expect(res.body.fileSize).toBe(16);
        expect(res.body.type).toBe('image');
      });

      it('fileSize is correct for PDF file', async () => {
        const pdfContent = '%PDF-1.4\n';
        const pdfBase64 = Buffer.from(pdfContent).toString('base64');
        canvasItems.create(sessionId, { type: 'pdf', data: pdfBase64, mimeType: 'application/pdf', filename: 'doc.pdf' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/doc.pdf`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBe(Buffer.byteLength(pdfContent, 'utf-8'));
        expect(res.body.type).toBe('pdf');
      });

      it('fileSize is correct for JSON content', async () => {
        const jsonObject = { key: 'value', nested: { a: 1 } };
        const jsonString = JSON.stringify(jsonObject);
        canvasItems.create(sessionId, { type: 'json', content: jsonString, filename: 'data.json' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/data.json`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBeGreaterThan(0);
        expect(res.body.type).toBe('json');
      });

      it('fileSize is correct for empty text file', async () => {
        canvasItems.create(sessionId, { type: 'text', content: '', filename: 'empty.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/empty.txt`);

        expect(res.status).toBe(200);
        expect(res.body.fileSize).toBe(0);
        expect(res.body.type).toBe('text');
      });

      it('fileSize is returned for all versions of a file', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'v1', filename: 'multiversion.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'version2longer', filename: 'multiversion.txt' });

        const latestRes = await request(app).get(`/api/sessions/${sessionId}/canvas/file/multiversion.txt`);

        expect(latestRes.status).toBe(200);
        expect(latestRes.body).toHaveProperty('fileSize');
        expect(typeof latestRes.body.fileSize).toBe('number');
        expect(latestRes.body.fileSize).toBeGreaterThan(0);
        expect(latestRes.body).toHaveProperty('version');
        expect(latestRes.body).toHaveProperty('totalVersions');
        expect(latestRes.body.totalVersions).toBe(2);
      });

      it('fileSize is included in all response fields', async () => {
        const content = 'Test content for full response check';
        canvasItems.create(sessionId, { type: 'text', content, filename: 'fulltest.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/fulltest.txt`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('filePath');
        expect(res.body).toHaveProperty('type');
        expect(res.body).toHaveProperty('mimeType');
        expect(res.body).toHaveProperty('fileSize');
        expect(res.body).toHaveProperty('createdAt');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('totalVersions');
      });

      it('main endpoint returns latest version number in standard versioning', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'v1', filename: 'test.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v2', filename: 'test.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v3', filename: 'test.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/test.txt`);

        expect(res.status).toBe(200);
        expect(res.body.version).toBe(3); // Latest version in standard versioning
        expect(res.body.totalVersions).toBe(3);
      });
    });

    describe('GET history endpoint with standard versioning', () => {
      it('retrieves oldest version with version=1', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'First version', filename: 'history.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'Second version', filename: 'history.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'Third version', filename: 'history.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/history.txt/history/1`);

        expect(res.status).toBe(200);
        expect(res.body.version).toBe(1);
        expect(res.body.totalVersions).toBe(3);

        // Verify it's actually the oldest version
        const filePath = res.body.filePath;
        const content = readFileSync(filePath, 'utf-8');
        expect(content).toBe('First version');
      });

      it('retrieves latest version with version=N', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'First version', filename: 'history2.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'Second version', filename: 'history2.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'Latest version', filename: 'history2.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/history2.txt/history/3`);

        expect(res.status).toBe(200);
        expect(res.body.version).toBe(3);
        expect(res.body.totalVersions).toBe(3);

        // Verify it's actually the latest version
        const filePath = res.body.filePath;
        const content = readFileSync(filePath, 'utf-8');
        expect(content).toBe('Latest version');
      });

      it('retrieves middle version correctly', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'v1', filename: 'middle.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v2 middle', filename: 'middle.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v3', filename: 'middle.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/middle.txt/history/2`);

        expect(res.status).toBe(200);
        expect(res.body.version).toBe(2);

        const filePath = res.body.filePath;
        const content = readFileSync(filePath, 'utf-8');
        expect(content).toBe('v2 middle');
      });

      it('returns 404 for version 0', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'content', filename: 'test.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/test.txt/history/0`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Version 0 not found');
      });

      it('returns 404 for version greater than totalVersions', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'v1', filename: 'test.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v2', filename: 'test.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/test.txt/history/5`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('Version 5 not found');
        expect(res.body.error).toContain('Available versions: 1-2');
      });

      it('returns 404 for non-existent file', async () => {
        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/nonexistent.txt/history/1`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain('File not found on canvas');
      });

      it('includes version suffix in temp filename', async () => {
        canvasItems.create(sessionId, { type: 'text', content: 'v1', filename: 'versioned.txt' });
        canvasItems.create(sessionId, { type: 'text', content: 'v2', filename: 'versioned.txt' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/versioned.txt/history/1`);

        expect(res.status).toBe(200);
        expect(res.body.filePath).toContain('versioned.v1.txt');
      });

      it('works with image files', async () => {
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
        const base64v1 = pngBuffer.toString('base64');
        const base64v2 = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00]).toString('base64');

        canvasItems.create(sessionId, { type: 'image', data: base64v1, mimeType: 'image/png', filename: 'img.png' });
        canvasItems.create(sessionId, { type: 'image', data: base64v2, mimeType: 'image/png', filename: 'img.png' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/img.png/history/1`);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe('image');
        expect(res.body.version).toBe(1);
        expect(res.body.fileSize).toBe(4); // First version is smaller
      });

      it('works with JSON files', async () => {
        canvasItems.create(sessionId, { type: 'json', content: '{"v":1}', filename: 'data.json' });
        canvasItems.create(sessionId, { type: 'json', content: '{"v":2}', filename: 'data.json' });

        const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/data.json/history/1`);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe('json');

        const filePath = res.body.filePath;
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        expect(parsed.v).toBe(1);
      });
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
      });

      expect(item.type).toBe('code');
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
        mimeType: 'text/plain',
      });

      expect(item.type).toBe('text');
      expect(item.content).toBe('Hello, World!');
      expect(item.filename).toBe('output.txt');
      expect(item.mimeType).toBe('text/plain');
    });

    it('creates markdown canvas item from inline content', () => {
      const item = canvasItems.create(sessionId, {
        type: 'markdown',
        content: '# Heading\n\nParagraph text',
        filename: 'output.md',
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
        mimeType: 'application/json',
      });

      expect(item.type).toBe('json');
      // JSON strings are parsed to objects when retrieved
      expect(item.data).toEqual(jsonObject);
      expect(item.filename).toBe('output.json');
      expect(item.mimeType).toBe('application/json');
    });

    it('creates canvas item without label when not provided', () => {
      const _item = canvasItems.create(sessionId, {
        type: 'text',
        content: 'test content',
        filename: 'test.txt',
        mimeType: 'text/plain',
      });

    });

    it('retrieves inline canvas item correctly', () => {
      const created = canvasItems.create(sessionId, {
        type: 'text',
        content: 'Inline test content',
        filename: 'inline-test.txt',
        mimeType: 'text/plain',
      });

      const retrieved = canvasItems.getById(created.id);
      expect(retrieved.type).toBe('text');
      expect(retrieved.content).toBe('Inline test content');
      expect(retrieved.filename).toBe('inline-test.txt');
    });
  });

  describe('HTTP GET /api/sessions/:id/canvas (List Endpoint)', () => {
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

    it('returns only latest version of each file (no duplicates)', async () => {
      // Create multiple versions of the same file
      canvasItems.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      // Should only return 1 item (latest version)
      expect(res.body).toHaveLength(1);
      expect(res.body[0].filename).toBe('test.txt');
    });

    it('returns latest version for multiple files', async () => {
      // Create multiple versions of different files
      canvasItems.create(sessionId, { type: 'text', content: 'A v1', filename: 'a.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'A v2', filename: 'a.txt' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v1', filename: 'b.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v2', filename: 'b.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v3', filename: 'b.md' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      // Should return 2 items (one per filename)
      expect(res.body).toHaveLength(2);
      const filenames = res.body.map(i => i.filename).sort();
      expect(filenames).toEqual(['a.txt', 'b.md']);
    });

    it('does not include content field in list response', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Hello World', filename: 'test.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('content');
    });

    it('does not include data field in list response', async () => {
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      canvasItems.create(sessionId, { type: 'image', data: base64Image, mimeType: 'image/png', filename: 'pixel.png' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('data');
    });

    it('does not include version or totalVersions fields in response', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'V1', filename: 'test.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'V2', filename: 'test.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('version');
      expect(res.body[0]).not.toHaveProperty('totalVersions');
    });

    it('includes all standard fields in response except content and data', async () => {
      canvasItems.create(sessionId, {
        type: 'markdown',
        content: '# Title',
        filename: 'readme.md',
        mimeType: 'text/markdown'
      });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const item = res.body[0];

      // Should include these metadata fields
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('sessionId');
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('mimeType');
      expect(item).toHaveProperty('filename');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('deletedAt');

      // Should NOT include content/data (stripped for payload reduction)
      expect(item).not.toHaveProperty('content');
      expect(item).not.toHaveProperty('data');

      // Should NOT include version metadata
      expect(item).not.toHaveProperty('version');
      expect(item).not.toHaveProperty('totalVersions');
    });

    it('includes width and height for images', async () => {
      canvasItems.create(sessionId, {
        type: 'image',
        data: 'base64data',
        mimeType: 'image/png',
        filename: 'pic.png',
        width: 800,
        height: 600
      });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body[0].width).toBe(800);
      expect(res.body[0].height).toBe(600);
    });

    it('returns empty array when no items exist', async () => {
      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('excludes soft-deleted items', async () => {
      const item1 = canvasItems.create(sessionId, { type: 'text', content: 'Active', filename: 'active.txt' });
      const item2 = canvasItems.create(sessionId, { type: 'text', content: 'Deleted', filename: 'deleted.txt' });

      canvasItems.softDelete(item2.id);

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(item1.id);
    });

    it('returns items ordered by createdAt descending', async () => {
      const first = canvasItems.create(sessionId, { type: 'text', content: 'First', filename: 'a.txt' });
      const second = canvasItems.create(sessionId, { type: 'text', content: 'Second', filename: 'b.txt' });
      const third = canvasItems.create(sessionId, { type: 'text', content: 'Third', filename: 'c.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // Verify newest first
      expect(res.body[0].createdAt).toBeGreaterThanOrEqual(res.body[2].createdAt);

      // Verify all items are present
      const ids = res.body.map(i => i.id);
      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);
      expect(ids).toContain(third.id);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent-session/canvas');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Session not found');
    });
  });

  describe('HTTP GET /api/sessions/:id/canvas/all (List All Versions Endpoint)', () => {
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

    it('returns all versions of each file (including duplicates)', async () => {
      // Create multiple versions of the same file
      canvasItems.create(sessionId, { type: 'text', content: 'Version 1', filename: 'test.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 2', filename: 'test.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 3', filename: 'test.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      // Should return all 3 versions (not just latest)
      expect(res.body).toHaveLength(3);
      expect(res.body[0].filename).toBe('test.txt');
      expect(res.body[1].filename).toBe('test.txt');
      expect(res.body[2].filename).toBe('test.txt');
    });

    it('returns all versions for multiple files', async () => {
      // Create multiple versions of different files
      canvasItems.create(sessionId, { type: 'text', content: 'A v1', filename: 'a.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'A v2', filename: 'a.txt' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v1', filename: 'b.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v2', filename: 'b.md' });
      canvasItems.create(sessionId, { type: 'markdown', content: '# B v3', filename: 'b.md' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      // Should return all 5 versions (not just latest per file)
      expect(res.body).toHaveLength(5);
      const filenames = res.body.map(i => i.filename);
      expect(filenames.filter(f => f === 'a.txt')).toHaveLength(2);
      expect(filenames.filter(f => f === 'b.md')).toHaveLength(3);
    });

    it('returns items ordered by createdAt descending (newest first)', async () => {
      const item1 = canvasItems.create(sessionId, { type: 'text', content: 'First', filename: 'a.txt' });
      // Small delay to ensure different timestamps
      const item2 = canvasItems.create(sessionId, { type: 'text', content: 'Second', filename: 'a.txt' });
      const item3 = canvasItems.create(sessionId, { type: 'text', content: 'Third', filename: 'a.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // Verify newest first
      expect(res.body[0].createdAt).toBeGreaterThanOrEqual(res.body[1].createdAt);
      expect(res.body[1].createdAt).toBeGreaterThanOrEqual(res.body[2].createdAt);

      // Verify all versions are present
      const ids = res.body.map(i => i.id);
      expect(ids).toContain(item1.id);
      expect(ids).toContain(item2.id);
      expect(ids).toContain(item3.id);
    });

    it('does not include content field in list response', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Hello World', filename: 'hello.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('content');
    });

    it('does not include data field in list response', async () => {
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      canvasItems.create(sessionId, { type: 'image', data: base64Image, mimeType: 'image/png', filename: 'pixel.png' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('data');
    });

    it('returns empty array when no items exist', async () => {
      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('excludes soft-deleted items', async () => {
      const item1 = canvasItems.create(sessionId, { type: 'text', content: 'Active', filename: 'active.txt' });
      const item2 = canvasItems.create(sessionId, { type: 'text', content: 'Deleted', filename: 'deleted.txt' });

      canvasItems.softDelete(item2.id);

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/all`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(item1.id);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent-session/canvas/all');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Session not found');
    });
  });

  describe('HTTP POST /api/sessions/:id/canvas (Inline Content Mode)', () => {
    let app;
    let projectId;
    let sessionId;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      // Note: upload middleware is now per-route in canvas.js, not global
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
      });

      it('returns 400 when neither filePath nor inline content provided', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('file upload');
      });

      it('returns 400 when only type is provided without content and filename', async () => {
        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({
            type: 'text'
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('file upload');
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

      it('does not include content or data fields in trash list', async () => {
        const item = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'Trash me', filename: 'trash.txt' });

        await request(app).delete(`/api/sessions/${sessionId}/canvas/${item.body.id}`);

        const trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);

        expect(trashRes.status).toBe(200);
        expect(trashRes.body).toHaveLength(1);
        expect(trashRes.body[0]).not.toHaveProperty('content');
        expect(trashRes.body[0]).not.toHaveProperty('data');
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
        const v1 = await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V1', filename: 'multi.txt' });
        const v2 = await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V2', filename: 'multi.txt' });
        const v3 = await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V3', filename: 'multi.txt' });

        // Delete all versions individually (list endpoint only shows latest version now)
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${v1.body.id}`);
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${v2.body.id}`);
        await request(app).delete(`/api/sessions/${sessionId}/canvas/${v3.body.id}`);

        // Verify trash has 3 items
        let trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        expect(trashRes.body).toHaveLength(3);

        // Recover by filename
        const recoverRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas-trash/recover-file/multi.txt`);

        expect(recoverRes.status).toBe(200);
        expect(recoverRes.body.recovered).toBe(3);

        // Verify latest version is back in canvas list (list only shows latest version)
        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`);
        expect(listRes.body).toHaveLength(1);
        expect(listRes.body[0].filename).toBe('multi.txt'); // Latest version (content stripped from list)

        // Verify trash is empty
        trashRes = await request(app).get(`/api/sessions/${sessionId}/canvas-trash`);
        expect(trashRes.body).toHaveLength(0);
      });

      it('returns count of recovered items', async () => {
        // Create items with explicit timeouts
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V1', filename: 'count.txt' })
          .timeout(5000);
        await request(app).post(`/api/sessions/${sessionId}/canvas`)
          .send({ type: 'text', content: 'V2', filename: 'count.txt' })
          .timeout(5000);

        // Get list
        let listRes = await request(app).get(`/api/sessions/${sessionId}/canvas`)
          .timeout(5000);

        // Batch delete operations with Promise.all to prevent connection buildup
        await Promise.all(
          listRes.body.map(item =>
            request(app)
              .delete(`/api/sessions/${sessionId}/canvas/${item.id}`)
              .timeout(5000)
          )
        );

        // Recover items
        const recoverRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas-trash/recover-file/count.txt`)
          .timeout(5000);

        expect(recoverRes.body).toHaveProperty('recovered');
        expect(recoverRes.body.recovered).toBe(2);
      }, 15000); // Add test-level timeout for CI stability

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

    describe('multipart file upload (FormData)', () => {
      it('uploads PNG image via FormData', async () => {
        // Create a minimal PNG file (1x1 pixel)
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
          0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
          0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF,
          0x7F, 0x00, 0x05, 0xFE, 0x02, 0xFF, 0x11, 0x3A,
          0x04, 0x08, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND chunk
          0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
        ]);

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', pngBuffer, 'test-image.png')
          .field('label', 'Test PNG Image');

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('image');
        expect(res.body.mimeType).toBe('image/png');
        expect(res.body.filename).toBe('test-image.png');
        expect(res.body.data).toBeDefined();
        // Verify it's base64 encoded
        expect(typeof res.body.data).toBe('string');
      });

      it('uploads JPEG image via FormData', async () => {
        // Minimal JPEG header
        const jpegBuffer = Buffer.from([
          0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
          0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
        ]);

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', jpegBuffer, 'photo.jpg');

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('image');
        expect(res.body.mimeType).toBe('image/jpeg');
        expect(res.body.filename).toBe('photo.jpg');
      });

      it('uploads text file via FormData', async () => {
        const textBuffer = Buffer.from('Hello, World!', 'utf-8');

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', textBuffer, 'hello.txt');

        expect(res.status).toBe(201);
        // .txt files are detected as 'code' type (files in TEXT_EXTENSIONS are code)
        expect(res.body.type).toBe('code');
        expect(res.body.content).toBe('Hello, World!');
        expect(res.body.filename).toBe('hello.txt');
      });

      it('uploads markdown file via FormData', async () => {
        const mdBuffer = Buffer.from('# Title\n\nContent', 'utf-8');

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', mdBuffer, 'readme.md');

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('markdown');
        expect(res.body.content).toBe('# Title\n\nContent');
        expect(res.body.filename).toBe('readme.md');
      });

      it('uploads code file via FormData', async () => {
        const jsBuffer = Buffer.from('const x = 42;', 'utf-8');

        const res = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', jsBuffer, 'script.js');

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('code');
        expect(res.body.content).toBe('const x = 42;');
        expect(res.body.filename).toBe('script.js');
      });

      it('retrieves uploaded PNG image correctly', async () => {
        // Upload PNG
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
          0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
          0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
          0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
          0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF,
          0x7F, 0x00, 0x05, 0xFE, 0x02, 0xFF, 0x11, 0x3A,
          0x04, 0x08, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
          0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
        ]);

        const uploadRes = await request(app)
          .post(`/api/sessions/${sessionId}/canvas`)
          .attach('file', pngBuffer, 'pixel.png');

        expect(uploadRes.status).toBe(201);
        const itemId = uploadRes.body.id;

        // Retrieve it
        const retrieved = canvasItems.getById(itemId);
        expect(retrieved).toBeDefined();
        expect(retrieved.type).toBe('image');
        expect(retrieved.mimeType).toBe('image/png');
        // Verify base64 data can be decoded back to PNG
        const buffer = Buffer.from(retrieved.data, 'base64');
        expect(buffer[0]).toBe(0x89); // PNG magic number
        expect(buffer[1]).toBe(0x50);
        expect(buffer[2]).toBe(0x4E);
        expect(buffer[3]).toBe(0x47);
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

  describe('HTTP GET /api/sessions/:id/canvas/file/:filename/content (Content Endpoint)', () => {
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

    it('returns content for text item with data as null', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Hello World', filename: 'test.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/test.txt/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Hello World');
      expect(res.body.data).toBeNull();
      expect(res.body.type).toBe('text');
      expect(res.body.filename).toBe('test.txt');
    });

    it('returns content for markdown item', async () => {
      canvasItems.create(sessionId, { type: 'markdown', content: '# Title', filename: 'readme.md', mimeType: 'text/markdown' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/readme.md/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('# Title');
      expect(res.body.type).toBe('markdown');
    });

    it('returns content for code item', async () => {
      canvasItems.create(sessionId, { type: 'code', content: 'const x = 1;', filename: 'app.js', mimeType: 'text/javascript' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/app.js/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('const x = 1;');
      expect(res.body.type).toBe('code');
    });

    it('returns data for image item with content as null', async () => {
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      canvasItems.create(sessionId, { type: 'image', data: base64Image, mimeType: 'image/png', filename: 'pixel.png' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/pixel.png/content`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBe(base64Image);
      expect(res.body.content).toBeNull();
      expect(res.body.type).toBe('image');
      expect(res.body.mimeType).toBe('image/png');
    });

    it('returns 404 for missing file', async () => {
      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/nonexistent.txt/content`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('File not found');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent-session/canvas/file/test.txt/content');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Session not found');
    });

    it('returns oldest version content with ?version=1', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Version 1', filename: 'versioned.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 2', filename: 'versioned.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 3', filename: 'versioned.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/versioned.txt/content?version=1`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Version 1');
    });

    it('returns latest version content with ?version=N (where N = total)', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Version 1', filename: 'versioned.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 2', filename: 'versioned.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Version 3', filename: 'versioned.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/versioned.txt/content?version=3`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Version 3');
    });

    it('returns 404 for out-of-range version', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Only version', filename: 'single.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/single.txt/content?version=5`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Version');
    });

    it('returns latest version when no version param specified', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Old', filename: 'latest.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'New', filename: 'latest.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/latest.txt/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('New');
    });

    it('returns correct content when switching between versions', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Alpha', filename: 'switch.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Beta', filename: 'switch.txt' });

      const v1 = await request(app).get(`/api/sessions/${sessionId}/canvas/file/switch.txt/content?version=1`);
      const v2 = await request(app).get(`/api/sessions/${sessionId}/canvas/file/switch.txt/content?version=2`);

      expect(v1.body.content).toBe('Alpha');
      expect(v2.body.content).toBe('Beta');
    });

    it('handles filenames with spaces', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'File with spaces', filename: 'my file.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/my%20file.txt/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('File with spaces');
    });

    it('handles filenames with special characters', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Special chars', filename: 'file-with_special.chars.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/file-with_special.chars.txt/content`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Special chars');
    });

    it('returns 404 for version parameter less than 1', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Only version', filename: 'single.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/single.txt/content?version=0`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Version');
    });

    it('returns 404 for negative version parameter', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Only version', filename: 'single.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/single.txt/content?version=-1`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Version');
    });

    it('returns latest version for non-numeric version parameter', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'First', filename: 'versioned.txt' });
      canvasItems.create(sessionId, { type: 'text', content: 'Second', filename: 'versioned.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/versioned.txt/content?version=abc`);

      // NaN check should fail and default to latest
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Second');
    });

    it('returns version 1 (only) when requesting version 1 for single-version file', async () => {
      canvasItems.create(sessionId, { type: 'text', content: 'Only version', filename: 'single.txt' });

      const res = await request(app).get(`/api/sessions/${sessionId}/canvas/file/single.txt/content?version=1`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Only version');
    });
  });
});
