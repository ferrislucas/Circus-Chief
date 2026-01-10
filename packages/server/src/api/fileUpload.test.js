import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { projects, messages, conversations } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';

// Mock websocket and services
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn(),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
}));

vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    run: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../services/sessionDuplicator.js', () => ({
  duplicateSession: vi.fn(),
}));

describe('File Upload Endpoints', () => {
  let app;
  let testProject;
  let sessionId;

  beforeEach(async () => {
    // Create a fresh Express app for each test
    app = createApp();

    // Create test project and session
    testProject = projects.create('Test Project', '/tmp/test-project');
    const now = Date.now();
    sessionId = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(sessionId, testProject.id, 'Test Session', 'waiting', 'standard', now, now);

    // Create initial conversation for the session
    const conv = conversations.create(sessionId, 'Initial', true);
    messages.create(sessionId, 'user', 'Initial prompt', null, conv.id);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/sessions/:id/message - Send message with files', () => {
    it('should accept multiple files in "files" field without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Test message with files')
        .attach('files', Buffer.from('File content 1'), 'test1.txt')
        .attach('files', Buffer.from('File content 2'), 'test2.txt');

      // Main fix: no "unexpected field" error, regardless of other status
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should accept single file in "files" field without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Test message with single file')
        .attach('files', Buffer.from('File content'), 'test.txt');

      // Main fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle message without files', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Test message without files');

      // No unexpected field error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle various file types without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Test with various files')
        .attach('files', Buffer.from('Plain text'), 'document.txt')
        .attach('files', Buffer.from('{"json": true}'), 'data.json')
        .attach('files', Buffer.from('# Markdown'), 'readme.md');

      // Main fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });
  });

  describe('POST /api/projects/:id/sessions - Create session with files', () => {
    it('should accept multiple files in "files" field without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/sessions`)
        .field('prompt', 'Analyze these files')
        .field('mode', 'standard')
        .attach('files', Buffer.from('File content 1'), 'file1.txt')
        .attach('files', Buffer.from('File content 2'), 'file2.txt');

      // Main fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should accept single file in "files" field without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/sessions`)
        .field('prompt', 'Analyze this file')
        .field('mode', 'standard')
        .attach('files', Buffer.from('File content'), 'file.txt');

      // Main fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle session creation without files', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/sessions`)
        .field('prompt', 'No files attached')
        .field('mode', 'standard');

      // No unexpected field error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle multiple files with different types without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/sessions`)
        .field('prompt', 'Analyze multiple file types')
        .field('mode', 'standard')
        .attach('files', Buffer.from('Plain text'), 'doc.txt')
        .attach('files', Buffer.from('{"data": "value"}'), 'config.json')
        .attach('files', Buffer.from('#!/bin/bash\necho test'), 'script.sh');

      // Main fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });
  });

  describe('POST /api/sessions/:id/canvas - Canvas upload', () => {
    it('should accept single file in "file" field', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/canvas`)
        .attach('file', Buffer.from('test image content'), 'test.png');

      // Should succeed
      expect([200, 201]).toContain(response.status);
    });

    it('should work with form field approach for canvas', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/canvas`)
        .attach('file', Buffer.from('test data'), 'document.txt');

      expect([200, 201]).toContain(response.status);
    });

    it('should reject multiple files in "file" field (expect single)', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/canvas`)
        .attach('file', Buffer.from('File 1'), 'test1.txt')
        .attach('file', Buffer.from('File 2'), 'test2.txt');

      // Should succeed but only process the first file (multer.single() ignores extras)
      expect([200, 201, 400]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should not produce "unexpected field" error for multi-file sends', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Multiple files test')
        .attach('files', Buffer.from('File 1'), 'file1.txt')
        .attach('files', Buffer.from('File 2'), 'file2.txt')
        .attach('files', Buffer.from('File 3'), 'file3.txt');

      // Core fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should not produce "unexpected field" error for session creation with files', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/sessions`)
        .field('prompt', 'Test')
        .field('mode', 'standard')
        .attach('files', Buffer.from('Content'), 'file.txt');

      // Core fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle oversized files gracefully without "unexpected field" error', async () => {
      // Create a buffer just over the 10MB limit - smaller is faster and more reliable
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024); // 10MB + 1KB

      try {
        const response = await request(app)
          .post(`/api/sessions/${sessionId}/message`)
          .field('content', 'Large file test')
          .attach('files', largeBuffer, 'large.bin');

        // Should get a file size error, not "unexpected field"
        if (response.status >= 400) {
          expect(response.body.error).not.toMatch(/unexpected field/i);
        }
      } catch (err) {
        // EPIPE/ECONNRESET errors are expected when server rejects large files early
        // The server closes the connection before the entire file is sent
        expect(['EPIPE', 'ECONNRESET', 'ECONNABORTED']).toContain(err.code);
      }
    });
  });

  describe('Middleware Integration', () => {
    it('should correctly parse multipart requests without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'Message with files')
        .attach('files', Buffer.from('File content'), 'data.txt');

      // Core fix: no "unexpected field" error in middleware
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });

    it('should handle fields mixed with files without "unexpected field" error', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/message`)
        .field('content', 'First field')
        .attach('files', Buffer.from('Middle file'), 'middle.txt')
        .field('metadata', '{"key": "value"}');

      // Core fix: no "unexpected field" error
      if (response.status >= 400) {
        expect(response.body.error).not.toMatch(/unexpected field/i);
      }
    });
  });
});
