import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { projects } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import sessionsRouter from './sessions.js';

describe('Sessions API - File Endpoint', () => {
  let app;
  let testDir;
  let sessionId;
  let projectId;

  beforeEach(() => {
    // Create test directory for file operations
    testDir = `/tmp/claudetools-test-${  Date.now()}`;
    mkdirSync(testDir, { recursive: true });

    // Create Express app with sessions router
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create project
    const project = projects.create('Test Project', testDir);
    projectId = project.id;

    // Create session directly using databaseManager
    const id = databaseManager.generateId();
    const now = Date.now();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, 'Test Session', 'running', 'standard', now, now);

    sessionId = id;
  });

  afterEach(() => {
    // Cleanup test directory
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  describe('GET /api/sessions/:id/file', () => {
    it('successfully returns a PNG image file as base64', async () => {
      // Create a minimal PNG file (1x1 pixel)
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF,
        0x7F, 0x00, 0x05, 0xFE, 0x02, 0xFF, 0x11, 0x3A,
        0x04, 0x08, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND
        0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);

      writeFileSync(join(testDir, 'test.png'), pngBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'test.png' });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.mimeType).toBe('image/png');
      expect(res.body.filename).toBe('test.png');

      // Verify we can decode the base64 back to the original PNG
      const decodedBuffer = Buffer.from(res.body.data, 'base64');
      expect(decodedBuffer[0]).toBe(0x89); // PNG signature
      expect(decodedBuffer[1]).toBe(0x50);
    });

    it('successfully returns a JPEG image file as base64', async () => {
      // Minimal JPEG header
      const jpegBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
      ]);

      writeFileSync(join(testDir, 'photo.jpg'), jpegBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'photo.jpg' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/jpeg');
      expect(res.body.filename).toBe('photo.jpg');
      expect(res.body.data).toBeDefined();
    });

    it('supports JPEG with .jpeg extension', async () => {
      const jpegBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01
      ]);

      writeFileSync(join(testDir, 'image.jpeg'), jpegBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'image.jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/jpeg');
    });

    it('supports WebP images', async () => {
      // Minimal WebP file signature
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x00, 0x00, 0x00, // File size
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);

      writeFileSync(join(testDir, 'image.webp'), webpBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'image.webp' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/webp');
    });

    it('supports GIF images', async () => {
      // GIF signature
      const gifBuffer = Buffer.from('GIF89a', 'ascii');

      writeFileSync(join(testDir, 'image.gif'), gifBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'image.gif' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/gif');
    });

    it('supports SVG images', async () => {
      const svgContent = '<svg><rect width="100" height="100"/></svg>';
      writeFileSync(join(testDir, 'image.svg'), svgContent);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'image.svg' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/svg+xml');
    });

    it('returns 404 for non-existent session', { timeout: 30000 }, async () => {
      const res = await request(app)
        .get('/api/sessions/nonexistent/file')
        .query({ path: 'test.png' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Session not found');
    });

    it('returns 400 when path parameter is missing', async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('path query parameter is required');
    });

    it('returns 404 when file does not exist', async () => {
      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'nonexistent.png' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('File not found');
    });

    it('returns 400 for unsupported file types', async () => {
      // Create a file with unsupported extension
      const textBuffer = Buffer.from('some content');
      writeFileSync(join(testDir, 'file.txt'), textBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'file.txt' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only image files are supported');
    });

    it('prevents directory traversal attacks', async () => {
      // Create a file outside the test directory
      const maliciousPath = '../../etc/passwd';

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: maliciousPath });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('handles case-insensitive file extensions', async () => {
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

      writeFileSync(join(testDir, 'IMAGE.PNG'), pngBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'IMAGE.PNG' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/png');
    });

    it('handles subdirectory paths correctly', async () => {
      mkdirSync(join(testDir, 'subdir'), { recursive: true });

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

      writeFileSync(join(testDir, 'subdir', 'nested.png'), pngBuffer);

      const res = await request(app)
        .get(`/api/sessions/${sessionId}/file`)
        .query({ path: 'subdir/nested.png' });

      expect(res.status).toBe(200);
      expect(res.body.mimeType).toBe('image/png');
      expect(res.body.filename).toBe('subdir/nested.png');
    });
  });
});
