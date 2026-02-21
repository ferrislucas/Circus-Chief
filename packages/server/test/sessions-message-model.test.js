import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, conversations } from '../src/database.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create a temp directory for testing
let testTempDir;

// Mock websocket
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock session manager to avoid starting actual Claude processes
vi.mock('../src/services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock git setup
vi.mock('../src/services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn(),
}));

// Mock git service
vi.mock('../src/services/gitService.js', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock summary service
vi.mock('../src/services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  regenerateSummary: vi.fn().mockResolvedValue(null),
  cleanupSession: vi.fn(),
}));

// Mock hook service
vi.mock('../src/services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Import routers after mocking
import sessionsRouter from '../src/api/sessions.js';
import projectsRouter from '../src/api/projects.js';
import { runSession, continueSession } from '../src/services/sessionManager.js';
import { setupGitForSession } from '../src/services/gitSessionSetup.js';

describe('Sessions API - Model Parameter', () => {
  let app;
  let project;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a fresh temp directory for each test
    testTempDir = mkdtempSync(join(tmpdir(), 'sessions-model-test-'));

    // Update setupGitForSession mock to return the temp directory
    setupGitForSession.mockResolvedValue({
      workingDirectory: testTempDir,
      gitWorktree: null,
    });

    // Create test Express app
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
    app.use('/api/projects', projectsRouter);

    // Create test project with temp directory
    project = projects.create('Test Project', testTempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (testTempDir && existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/sessions/:id/message - Model Parameter', () => {
    let session;

    beforeEach(() => {
      session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
      sessions.update(session.id, { status: 'waiting' });
    });

    it('passes model to continueSession when provided', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Test message', model: 'claude-opus-4-6' })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify continueSession was called with the model
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Test message',
        testTempDir,
        null, // systemPrompt
        [], // attachments
        'claude-opus-4-6' // model
      );
    });

    it('passes null model to continueSession when not provided', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Test message' })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify continueSession was called with null model
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Test message',
        testTempDir,
        null, // systemPrompt
        [], // attachments
        null // model should be null when not provided
      );
    });

    it('passes model via form-data with files', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Test message')
        .field('model', 'claude-sonnet-4-6')
        .attach('files', Buffer.from('test content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify continueSession was called with the model
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Test message',
        testTempDir,
        null,
        expect.any(Array), // attachments
        'claude-sonnet-4-6'
      );
    });

    it('accepts tier name as model', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Test message', model: 'opus' })
        .expect(200);

      expect(response.body.success).toBe(true);

      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Test message',
        testTempDir,
        null,
        [],
        'opus'
      );
    });

    it('accepts custom provider model ID', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Test message', model: 'custom-provider-model-v2' })
        .expect(200);

      expect(response.body.success).toBe(true);

      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Test message',
        testTempDir,
        null,
        [],
        'custom-provider-model-v2'
      );
    });

    it('can switch models between messages', async () => {
      // First message with opus
      await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'First message', model: 'claude-opus-4-6' })
        .expect(200);

      expect(continueSession).toHaveBeenLastCalledWith(
        session.id,
        'First message',
        testTempDir,
        null,
        [],
        'claude-opus-4-6'
      );

      // Second message with sonnet
      await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Second message', model: 'claude-sonnet-4-6' })
        .expect(200);

      expect(continueSession).toHaveBeenLastCalledWith(
        session.id,
        'Second message',
        testTempDir,
        null,
        [],
        'claude-sonnet-4-6'
      );
    });
  });

  describe('POST /api/sessions/:id/start - Model Parameter', () => {
    let session;

    beforeEach(() => {
      // Create a draft session (waiting status, has user message, no assistant messages)
      session = sessions.create(project.id, 'Draft Session', 'Draft prompt', 'standard');
      sessions.update(session.id, { status: 'waiting' });
    });

    it('passes model to runSession when provided', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ model: 'claude-opus-4-6' })
        .expect(200);

      // Response includes success and session object
      expect(response.body.success).toBe(true);
      expect(response.body.session.status).toBe('starting');

      // Verify runSession was called with the model
      expect(runSession).toHaveBeenCalledWith(
        session.id,
        expect.any(String), // prompt
        testTempDir,
        null, // systemPrompt
        expect.any(Array), // attachments
        'claude-opus-4-6' // model
      );
    });

    it('passes null model to runSession when not provided', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.session.status).toBe('starting');

      // Verify runSession was called with null model
      expect(runSession).toHaveBeenCalledWith(
        session.id,
        expect.any(String),
        testTempDir,
        null,
        expect.any(Array),
        null // model should be null
      );
    });

    it('starts draft session with custom model', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .send({ model: 'custom-provider-sonnet' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.session.status).toBe('starting');

      expect(runSession).toHaveBeenCalledWith(
        session.id,
        expect.any(String),
        testTempDir,
        null,
        expect.any(Array),
        'custom-provider-sonnet'
      );
    });
  });

  describe('PATCH /api/sessions/:id - Provider Parameter', () => {
    let session;

    beforeEach(() => {
      session = sessions.create(project.id, 'Test Session', 'Test prompt', 'standard');
    });

    it('returns error for non-existent provider ID', async () => {
      const response = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ providerId: 'non-existent-provider' })
        .expect(400);

      expect(response.body.error).toBe('Provider not found');
    });
  });
});
