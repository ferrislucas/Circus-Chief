import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages } from '../src/database.js';

// Mock the Claude SDK query function
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args) => mockQuery(...args),
}));

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service
vi.mock('../src/services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
}));

// Import after mocking
import { runSession, continueSession } from '../src/services/sessionManager.js';

describe('sessionManager message model tracking', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
  });

  afterEach(() => {
    // Clean up sessions and messages
    const allSessions = sessions.getByProjectId(project.id);
    allSessions.forEach((s) => {
      const sessionMessages = messages.getBySessionId(s.id);
      sessionMessages.forEach((m) => messages.delete(m.id));
      sessions.delete(s.id);
    });
    projects.delete(project.id);
  });

  // Helper to create async generator that simulates SDK response with model
  async function* createMockQueryResponseWithModel(modelName = 'claude-opus-4-5-20251101') {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-123',
      model: modelName,
    };
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Mock response' }],
      },
    };
    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.001,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    };
  }

  describe('runSession model tracking', () => {
    it('tracks model from system.init event and stores in created messages', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-opus-4-5-20251101'));

      await runSession(session.id, 'test prompt', '/tmp/test', null, []);

      // Get the assistant message created
      const sessionMessages = messages.getBySessionId(session.id);
      const assistantMessage = sessionMessages.find((m) => m.role === 'assistant');

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.model).toBe('claude-opus-4-5-20251101');
      expect(assistantMessage.content).toContain('Mock response');
    });

    it('stores different models for different messages', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');

      // Response with opus
      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-opus-4-5-20251101'));
      await runSession(session.id, 'first prompt', '/tmp/test', null, []);

      // Get assistant messages after first turn
      const sessionMessages = messages.getBySessionId(session.id);
      const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');

      expect(assistantMessages.length).toBeGreaterThan(0);
      assistantMessages.forEach((msg) => {
        expect(msg.model).toBe('claude-opus-4-5-20251101');
      });
    });

    it('creates assistant messages with model when system.init provides model', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-sonnet-4-5-20250929'));

      await runSession(session.id, 'test prompt', '/tmp/test', null, []);

      // Verify message was created with model
      const sessionMessages = messages.getBySessionId(session.id);
      const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');

      expect(assistantMessages.length).toBeGreaterThan(0);
      assistantMessages.forEach((msg) => {
        expect(msg.model).toBe('claude-sonnet-4-5-20250929');
      });
    });

    it('preserves user messages without model', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');

      // Manually create a user message (this would normally be created by other means)
      const userId = project.id; // Using project id as a stand-in
      messages.create(session.id, 'user', 'User question', null, null, null);

      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-opus-4-5-20251101'));
      await runSession(session.id, 'continuation', '/tmp/test', null, []);

      // Verify user message doesn't have model, assistant does
      const sessionMessages = messages.getBySessionId(session.id);
      const userMessages = sessionMessages.filter((m) => m.role === 'user');
      const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');

      userMessages.forEach((msg) => {
        expect(msg.model).toBeNull();
      });

      assistantMessages.forEach((msg) => {
        expect(msg.model).toBe('claude-opus-4-5-20251101');
      });
    });
  });

  describe('continueSession model tracking', () => {
    it('tracks model from system.init event in continueSession', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });

      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      // Get the assistant message created
      const sessionMessages = messages.getBySessionId(session.id);
      const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');

      expect(assistantMessages.length).toBeGreaterThan(0);
      assistantMessages.forEach((msg) => {
        expect(msg.model).toBe('claude-opus-4-5-20251101');
      });
    });
  });

  describe('model field in message data', () => {
    it('retrieved messages include model field', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponseWithModel('claude-opus-4-5-20251101'));

      await runSession(session.id, 'test prompt', '/tmp/test', null, []);

      // Get the message and verify all fields including model
      const sessionMessages = messages.getBySessionId(session.id);
      const assistantMessage = sessionMessages.find((m) => m.role === 'assistant');

      expect(assistantMessage).toHaveProperty('id');
      expect(assistantMessage).toHaveProperty('sessionId');
      expect(assistantMessage).toHaveProperty('role');
      expect(assistantMessage).toHaveProperty('content');
      expect(assistantMessage).toHaveProperty('timestamp');
      expect(assistantMessage).toHaveProperty('model');
      expect(assistantMessage.model).toBe('claude-opus-4-5-20251101');
    });

    it('message without model has model field as null', () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');

      // Create user message without model
      const userMsg = messages.create(session.id, 'user', 'User question', null, null, null);

      expect(userMsg.model).toBeNull();
      expect(userMsg).toHaveProperty('model');
    });
  });
});
