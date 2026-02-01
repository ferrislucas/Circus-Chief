import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages, conversations } from '../src/database.js';

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
  extractPrUrlIfNeeded: vi.fn(),
}));

// Import after mocking
import { runSession, continueSession } from '../src/services/sessionManager.js';

describe('sessionManager model switching mid-conversation', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
  });

  afterEach(() => {
    // Clean up sessions, messages, and conversations
    const allSessions = sessions.getByProjectId(project.id);
    allSessions.forEach((s) => {
      const sessionMessages = messages.getBySessionId(s.id);
      sessionMessages.forEach((m) => messages.delete(m.id));
      const sessionConversations = conversations.getBySessionId(s.id);
      sessionConversations.forEach((c) => conversations.delete(c.id));
      sessions.delete(s.id);
    });
    projects.delete(project.id);
  });

  // Helper to create async generator that simulates SDK response
  async function* createMockQueryResponse(modelName = 'claude-opus-4-5-20251101') {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: `claude-session-${Date.now()}`,
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

  describe('continueSession with model parameter', () => {
    it('passes model to SDK when provided', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('passes null model to SDK when not provided', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse(null));

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBeNull();
    });

    it('resumes session when model has not changed', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // First message - establishes the model
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Get the conversation and update its model (simulating what happens after SDK response)
      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Second message with same model - should resume
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCallParams = mockQuery.mock.calls[1][0];
      // Should have resume parameter when model hasn't changed
      expect(secondCallParams.options.resume).toBeDefined();
    });

    it('does NOT resume session when model changes', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // First message with opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Get the conversation and update its model
      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Second message with sonnet - model changed, should NOT resume
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCallParams = mockQuery.mock.calls[1][0];
      // Should NOT have resume parameter when model changed
      expect(secondCallParams.options.resume).toBeUndefined();
    });

    it('includes conversation context in prompt when model changes', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // First message with opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Get the conversation and update its model
      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Second message with different model
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCallParams = mockQuery.mock.calls[1][0];

      // The prompt should include conversation history context
      expect(secondCallParams.prompt).toContain('<conversation_history>');
      expect(secondCallParams.prompt).toContain('follow-up message');
    });

    it('does NOT include conversation context when model stays the same', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // First message
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Get the conversation and update its model
      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Second message with same model
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCallParams = mockQuery.mock.calls[1][0];

      // The prompt should NOT include conversation history context
      expect(secondCallParams.prompt).not.toContain('<conversation_history>');
      expect(secondCallParams.prompt).toBe('follow-up message');
    });
  });

  describe('conversation context format', () => {
    it('includes previous messages in conversation context when switching models', async () => {
      session = sessions.create(project.id, 'Test Session', 'Hello, can you help me?', 'standard');

      // First turn
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'Hello, can you help me?', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Update conversation model
      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Switch to different model
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));
      await continueSession(session.id, 'Now use sonnet please', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      const secondCallParams = mockQuery.mock.calls[1][0];

      // Should have the context header
      expect(secondCallParams.prompt).toContain('conversation history from this session');
      expect(secondCallParams.prompt).toContain('switched to a different model');
      // Should include the user's original message
      expect(secondCallParams.prompt).toContain('Hello, can you help me?');
      // Should include the assistant's response
      expect(secondCallParams.prompt).toContain('Mock response');
      // Should include the new message
      expect(secondCallParams.prompt).toContain('Now use sonnet please');
    });

    it('does not include context when there are no previous messages', async () => {
      session = sessions.create(project.id, 'Test Session', 'First message', 'standard');

      // First turn with opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'First message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // The runSession creates the initial user message and processes it
      // For this test, we need to check that on first message there's no context
      const firstCallParams = mockQuery.mock.calls[0][0];

      // First message should not have conversation history
      expect(firstCallParams.prompt).not.toContain('<conversation_history>');
    });
  });

  describe('model switching between providers', () => {
    it('allows switching from one model to another across messages', async () => {
      session = sessions.create(project.id, 'Test Session', 'start with opus', 'standard');

      // First with opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'start with opus', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Then sonnet
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));
      await continueSession(session.id, 'now use sonnet', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      // Check models were passed correctly
      expect(mockQuery.mock.calls[0][0].options.model).toBe('claude-opus-4-5-20251101');
      expect(mockQuery.mock.calls[1][0].options.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('tracks model changes across multiple switches', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');

      // Opus
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'opus turn', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      let conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Sonnet - should not resume
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-sonnet-4-5-20250929'));
      await continueSession(session.id, 'sonnet turn', '/tmp/test', null, [], 'claude-sonnet-4-5-20250929');

      conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-sonnet-4-5-20250929' });

      // Haiku - should not resume
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-3-5-haiku-latest'));
      await continueSession(session.id, 'haiku turn', '/tmp/test', null, [], 'claude-3-5-haiku-latest');

      expect(mockQuery).toHaveBeenCalledTimes(3);

      // First call should have resume (fresh session)
      expect(mockQuery.mock.calls[0][0].options.resume).toBeUndefined();
      // Second call - model changed from opus to sonnet, no resume
      expect(mockQuery.mock.calls[1][0].options.resume).toBeUndefined();
      // Third call - model changed from sonnet to haiku, no resume
      expect(mockQuery.mock.calls[2][0].options.resume).toBeUndefined();
    });
  });
});
