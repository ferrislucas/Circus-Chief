import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions } from '../src/database.js';

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

describe('sessionManager model handling', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
  });

  afterEach(() => {
    // Clean up sessions
    const allSessions = sessions.getByProjectId(project.id);
    allSessions.forEach((s) => sessions.delete(s.id));
    projects.delete(project.id);
  });

  // Helper to create async generator that simulates SDK response
  async function* createMockQueryResponse() {
    yield {
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-123',
      model: 'claude-sonnet-4-5-20250929',
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
    };
  }

  describe('runSession with model parameter', () => {
    it('passes model from parameter to SDK query options', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-opus-4-5-20251101');
    });

    it('uses session model when parameter is null', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-haiku-4-5-20251001');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-haiku-4-5-20251001');
    });

    it('parameter model takes precedence over session model', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      // Session has sonnet, but we pass opus as parameter
      await runSession(session.id, 'test prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-opus-4-5-20251101');
    });

    it('does not include model in options when both are null', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, null);
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBeUndefined();
    });
  });

  describe('continueSession with model', () => {
    it('passes session model to SDK query options', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      // Set claudeSessionId so session can be resumed
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-opus-4-5-20251101');
    });

    it('does not include model when session has no model', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, null);
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBeUndefined();
    });

    it('uses updated model after session update', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      sessions.update(session.id, { claudeSessionId: 'claude-session-123' });

      // Update model
      sessions.update(session.id, { model: 'claude-haiku-4-5-20251001' });
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await continueSession(session.id, 'follow-up message', '/tmp/test', null, []);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('model with other session options', () => {
    it('includes model alongside thinking mode settings', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'standard', true, null, 'claude-opus-4-5-20251101');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-opus-4-5-20251101');
      expect(queryParams.options.env).toBeDefined();
      expect(queryParams.options.env.MAX_THINKING_TOKENS).toBe('10240');
    });

    it('includes model alongside yolo mode permission settings', async () => {
      session = sessions.create(project.id, 'Test Session', 'prompt', 'yolo', false, null, 'claude-haiku-4-5-20251001');
      mockQuery.mockImplementation(() => createMockQueryResponse());

      await runSession(session.id, 'test prompt', '/tmp/test', null, [], null);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const queryParams = mockQuery.mock.calls[0][0];
      expect(queryParams.options.model).toBe('claude-haiku-4-5-20251001');
      expect(queryParams.options.permissionMode).toBe('bypassPermissions');
    });
  });
});
