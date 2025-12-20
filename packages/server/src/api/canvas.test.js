import { describe, it, expect, beforeEach } from 'vitest';
import { canvasItems, projects } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';

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
  });
});
