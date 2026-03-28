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
  cleanupActiveSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  generateSummary: vi.fn().mockResolvedValue('mock summary'),
  generateConversationSummary: vi.fn().mockResolvedValue('mock conversation summary'),
  onSessionActivity: vi.fn(),
  regenerateSummary: vi.fn(),
  cleanupSession: vi.fn(),
}));

// Mock diffService
vi.mock('../services/diffService.js', () => ({
  getDiff: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
  getChanges: vi.fn(),
  getChangesBranch: vi.fn(),
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';

describe('Sessions API - workflow-latest-response', () => {
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
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('GET /api/sessions/:id/workflow-latest-response', () => {
    it('returns 404 when session does not exist', async () => {
      const res = await request(app).get('/api/sessions/non-existent/workflow-latest-response');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('returns 404 when no assistant messages exist in workflow', async () => {
      // Session only has a user message from creation
      const res = await request(app).get(`/api/sessions/${session.id}/workflow-latest-response`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No assistant response found');
    });

    it('returns latest assistant message for single session', async () => {
      const conv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'Hello! How can I help?', { conversationId: conv.id });

      const res = await request(app).get(`/api/sessions/${session.id}/workflow-latest-response`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.role).toBe('assistant');
      expect(res.body.message.content).toBe('Hello! How can I help?');
      expect(res.body.sessionName).toBe('Test Session');
    });

    it('returns latest assistant message across parent-child workflow', async () => {
      // Add assistant message to parent session
      const parentConv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'Parent response', { conversationId: parentConv.id });

      // Create child session
      const childSession = sessions.create(project.id, 'Child Session', 'Child prompt', {
        parentSessionId: session.id,
      });
      const childConv = conversations.getActiveBySessionId(childSession.id);
      messages.create(childSession.id, 'assistant', 'Child response (newest)', { conversationId: childConv.id });

      const res = await request(app).get(`/api/sessions/${session.id}/workflow-latest-response`);

      expect(res.status).toBe(200);
      expect(res.body.message.content).toBe('Child response (newest)');
      expect(res.body.sessionName).toBe('Child Session');
    });

    it('includes correct sessionName in response', async () => {
      const conv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'Test response', { conversationId: conv.id });

      const res = await request(app).get(`/api/sessions/${session.id}/workflow-latest-response`);

      expect(res.status).toBe(200);
      expect(res.body.sessionName).toBe('Test Session');
    });

    it('works when called with a child session ID (not root)', async () => {
      // Add assistant message to parent session
      const parentConv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'assistant', 'Parent response', { conversationId: parentConv.id });

      // Create child session
      const childSession = sessions.create(project.id, 'Child Session', 'Child prompt', {
        parentSessionId: session.id,
      });

      // Call with child session ID - should still find parent's message
      const res = await request(app).get(`/api/sessions/${childSession.id}/workflow-latest-response`);

      expect(res.status).toBe(200);
      expect(res.body.message.content).toBe('Parent response');
      expect(res.body.sessionName).toBe('Test Session');
    });
  });
});
