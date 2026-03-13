import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, messages, conversations } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  continueSessionWithExistingMessage: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  regenerateSummary: vi.fn().mockResolvedValue(null),
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  isConversationSummaryEnabled: vi.fn().mockReturnValue(true),
  cleanupSession: vi.fn(),
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';

describe('Sessions API - Conversation Routes (sessions-conversations.js)', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('GET /api/sessions/:id/conversations', () => {
    it('returns conversations for the session', async () => {
      const res = await request(app).get(`/api/sessions/${session.id}/conversations`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Session auto-creates an initial conversation
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/non-existent/conversations');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/conversations', () => {
    it('creates a new conversation', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({ name: 'New Conversation' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Conversation');
      expect(res.body.sessionId).toBe(session.id);
      expect(res.body.isActive).toBe(true);
    });

    it('creates conversation with null name when not provided', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.name).toBeNull();
    });

    it('returns 400 when session is running', async () => {
      sessions.update(session.id, { status: 'running' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({ name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot create new conversation while session is running');
    });
  });

  describe('GET /api/sessions/:id/conversations/:convId', () => {
    it('returns conversation with message count', async () => {
      const conv = conversations.create(session.id, 'Test Conv', true);
      messages.create(session.id, 'user', 'Hello', null, conv.id);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/conversations/${conv.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(conv.id);
      expect(res.body.messageCount).toBe(1);
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await request(app)
        .get(`/api/sessions/${session.id}/conversations/non-existent`);

      expect(res.status).toBe(404);
    });

    it('returns 404 when conversation belongs to a different session', async () => {
      const otherSession = sessions.create(project.id, 'Other', 'Prompt', 'standard');
      const conv = conversations.create(otherSession.id, 'Other Conv', true);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/conversations/${conv.id}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/sessions/:id/conversations/:convId', () => {
    it('updates conversation name', async () => {
      const conv = conversations.create(session.id, 'Original', true);

      const res = await request(app)
        .patch(`/api/sessions/${session.id}/conversations/${conv.id}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('blocks switching when session is running', async () => {
      const conv = conversations.create(session.id, 'Test', false);
      sessions.update(session.id, { status: 'running' });

      const res = await request(app)
        .patch(`/api/sessions/${session.id}/conversations/${conv.id}`)
        .send({ isActive: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot switch conversation while session is running');
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}/conversations/non-existent`)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/sessions/:id/conversations/:convId', () => {
    it('deletes a conversation', async () => {
      // Create two conversations so we can delete one
      conversations.create(session.id, 'Keep', true);
      const conv2 = conversations.create(session.id, 'Delete', false);

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/conversations/${conv2.id}`);

      expect(res.status).toBe(204);
    });

    it('returns 400 when session is running', async () => {
      const conv = conversations.create(session.id, 'Test', true);
      sessions.update(session.id, { status: 'running' });

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/conversations/${conv.id}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot delete conversation while session is running');
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await request(app)
        .delete(`/api/sessions/${session.id}/conversations/non-existent`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/conversations/:convId/summary', () => {
    it('returns 404 for non-existent conversation', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations/non-existent/summary`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/conversations/:convId/branch', () => {
    it('returns 400 when messageId is missing', async () => {
      const conv = conversations.create(session.id, 'Test', true);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations/${conv.id}/branch`)
        .send({ prompt: 'branch prompt' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('messageId is required');
    });

    it('returns 400 when prompt is missing', async () => {
      const conv = conversations.create(session.id, 'Test', true);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations/${conv.id}/branch`)
        .send({ messageId: 'msg-1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('prompt is required');
    });

    it('returns 400 when session is running', async () => {
      const conv = conversations.create(session.id, 'Test', true);
      sessions.update(session.id, { status: 'running' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations/${conv.id}/branch`)
        .send({ messageId: 'msg-1', prompt: 'branch' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot branch conversation while session is running');
    });

    it('returns 404 for non-existent conversation', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/conversations/non-existent/branch`)
        .send({ messageId: 'msg-1', prompt: 'branch' });

      expect(res.status).toBe(404);
    });
  });
});
