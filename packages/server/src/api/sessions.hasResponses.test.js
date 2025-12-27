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
  stopSession: vi.fn(),
  restartSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  generateSummary: vi.fn().mockResolvedValue('mock summary'),
  generateConversationSummary: vi.fn().mockResolvedValue('mock conversation summary'),
}));

// Mock diffService
vi.mock('../services/diffService.js', () => ({
  getDiff: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';

describe('Sessions API - hasResponses', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test project and session
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    // Set session to waiting for most tests
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns hasResponses=false for session with no assistant messages', async () => {
      // Session is created with only a user message (the initial prompt)
      const res = await request(app).get(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(session.id);
      expect(res.body.hasResponses).toBe(false);
    });

    it('returns hasResponses=true for session with assistant messages', async () => {
      // Get the initial conversation
      const conv = conversations.getActiveBySessionId(session.id);

      // Add an assistant message
      messages.create(session.id, 'assistant', 'Hello! How can I help?', null, conv.id);

      const res = await request(app).get(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(session.id);
      expect(res.body.hasResponses).toBe(true);
    });

    it('returns hasResponses=true when assistant message is in a different conversation', async () => {
      // Get the initial conversation and add assistant response
      const conv1 = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'Response to first conv', null, conv1.id);

      // Create a new conversation (empty)
      const conv2 = conversations.create(session.id, 'New Conversation', true);

      // Even though the new conversation is now active and has no messages,
      // hasResponses should still be true because the session has assistant messages
      const res = await request(app).get(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      expect(res.body.hasResponses).toBe(true);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/non-existent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });

  describe('Draft session detection with hasResponses', () => {
    it('draft session has waiting status and hasResponses=false', async () => {
      // Create a draft session in waiting status
      const draftSession = sessions.create(project.id, 'Draft Session', 'Draft prompt', 'standard');
      sessions.update(draftSession.id, { status: 'waiting' });

      const res = await request(app).get(`/api/sessions/${draftSession.id}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('waiting');
      expect(res.body.hasResponses).toBe(false);
    });

    it('non-draft session in waiting status has hasResponses=true', async () => {
      // Add an assistant response to make it a non-draft
      const conv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'I responded', null, conv.id);

      // Session is in waiting status but has responses
      const res = await request(app).get(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('waiting');
      expect(res.body.hasResponses).toBe(true);
    });
  });
});
