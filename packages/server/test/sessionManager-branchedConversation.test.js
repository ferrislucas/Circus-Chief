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
import { runSession, continueSession, continueSessionWithExistingMessage } from '../src/services/sessionManager.js';

describe('sessionManager branched conversations', () => {
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

  describe('branched conversation detection', () => {
    it('detects branched conversation (has parentConversationId but no claudeSessionId)', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create original conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const originalConversation = conversations.getActiveBySessionId(session.id);
      conversations.update(originalConversation.id, { model: 'claude-opus-4-5-20251101' });

      // Get the first user message to branch from
      const convMessages = messages.getByConversationId(originalConversation.id);
      const firstUserMessage = convMessages.find(m => m.role === 'user');

      // Create a branched conversation using the branch() method
      const branchedConv = conversations.branch(
        originalConversation.id,
        firstUserMessage.id,
        'Branched Conversation',
        'Branching from here'
      );

      // Verify the branched conversation has parent but no claudeSessionId
      expect(branchedConv.parentConversationId).toBe(originalConversation.id);
      expect(branchedConv.claudeSessionId).toBeNull();
    });

    it('does NOT treat normal conversation as branched', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create normal conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, {
        model: 'claude-opus-4-5-20251101',
        claudeSessionId: conv.claudeSessionId // Use the actual session ID from runSession
      });

      // Verify normal conversation is not detected as branched
      expect(conv.parentConversationId).toBeNull();
      expect(conv.claudeSessionId).not.toBeNull();
    });
  });

  describe('continueSessionWithExistingMessage for branched conversations', () => {
    let originalConversation;

    beforeEach(async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create original conversation with multiple messages
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      originalConversation = conversations.getActiveBySessionId(session.id);
      conversations.update(originalConversation.id, { model: 'claude-opus-4-5-20251101' });

      // Add a second exchange
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');
    });

    it('includes conversation history in prompt for branched conversation', async () => {
      // Get the second user message to branch from (so there's history before it)
      const convMessages = messages.getByConversationId(originalConversation.id);
      const secondUserMessage = convMessages.find(m => m.role === 'user' && m.content === 'follow-up message');

      // Create branched conversation
      const branchedConv = conversations.branch(
        originalConversation.id,
        secondUserMessage.id,
        'Branch',
        'New branch message'
      );

      // Get the new message from the branched conversation
      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user' && m.content === 'New branch message');

      // Continue with the branched conversation using existing message
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      expect(mockQuery).toHaveBeenCalledTimes(3); // Initial, second message, branched
      const branchedCallParams = mockQuery.mock.calls[2][0];

      // The prompt should include conversation history context
      expect(branchedCallParams.prompt).toContain('<conversation_history>');
      expect(branchedCallParams.prompt).toContain('initial prompt');
      expect(branchedCallParams.prompt).toContain('Mock response');
      expect(branchedCallParams.prompt).toContain('New branch message');
    });

    it('does NOT resume session for branched conversation', async () => {
      const convMessages = messages.getByConversationId(originalConversation.id);
      const firstUserMessage = convMessages.find(m => m.role === 'user');

      const branchedConv = conversations.branch(
        originalConversation.id,
        firstUserMessage.id,
        'Branch',
        'Branch message'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const branchedCallParams = mockQuery.mock.calls[2][0];

      // Branched conversation should NOT have resume parameter
      expect(branchedCallParams.options.resume).toBeUndefined();
    });

    it('includes proper context header for branched conversations', async () => {
      // Get the second user message to branch from (so there's history before it)
      const convMessages = messages.getByConversationId(originalConversation.id);
      const secondUserMessage = convMessages.find(m => m.role === 'user' && m.content === 'follow-up message');

      const branchedConv = conversations.branch(
        originalConversation.id,
        secondUserMessage.id,
        'Branch',
        'Branch message'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const branchedCallParams = mockQuery.mock.calls[2][0];

      // Should have the branched conversation context header
      expect(branchedCallParams.prompt).toContain('branched session');
      expect(branchedCallParams.prompt).toContain('continuation of a previous conversation');
    });

    it('handles branched conversation with no history gracefully', async () => {
      // Create a fresh conversation with no messages
      const newConv = conversations.create(session.id, 'Empty Branch');

      // Add a single user message to the new conversation
      const userMsg = messages.create(
        session.id,
        'user',
        'Single message',
        null,
        newConv.id
      );

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        newConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const callParams = mockQuery.mock.calls[2][0];

      // Should include the message itself
      expect(callParams.prompt).toContain('Single message');
    });
  });

  describe('conversation history formatting', () => {
    it('formats messages with User and Assistant labels', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create conversation with multiple exchanges
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Add second exchange
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'follow-up message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Get the second user message to branch from (so there's history before it)
      const convMessages = messages.getByConversationId(conv.id);
      const secondUserMessage = convMessages.find(m => m.role === 'user' && m.content === 'follow-up message');

      // Create branched conversation
      const branchedConv = conversations.branch(
        conv.id,
        secondUserMessage.id,
        'Branch',
        'Branch message'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user' && m.content === 'Branch message');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const branchedCallParams = mockQuery.mock.calls[2][0];

      // Should have User and Assistant labels
      expect(branchedCallParams.prompt).toContain('User:');
      expect(branchedCallParams.prompt).toContain('Assistant:');
      expect(branchedCallParams.prompt).toContain('initial prompt');
      expect(branchedCallParams.prompt).toContain('Mock response');
    });

    it('truncates very long messages in history', async () => {
      // Create a very long user message (15000 characters)
      const longMessage = 'A'.repeat(15000);

      // Create session with the long message as initial prompt
      session = sessions.create(project.id, 'Test Session', longMessage, 'standard');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, longMessage, '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const conv = conversations.getActiveBySessionId(session.id);
      conversations.update(conv.id, { model: 'claude-opus-4-5-20251101' });

      // Add a second message to branch from (so the long message is in the history)
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSession(session.id, 'Second message', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      // Create branched conversation from the second message
      const convMessages = messages.getByConversationId(conv.id);
      const secondMessage = convMessages.find(m => m.role === 'user' && m.content === 'Second message');

      const branchedConv = conversations.branch(
        conv.id,
        secondMessage.id,
        'Branch',
        'Short branch'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user' && m.content === 'Short branch');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const branchedCallParams = mockQuery.mock.calls[2][0];

      // Should indicate truncation
      expect(branchedCallParams.prompt).toContain('[... message truncated ...]');
      // The prompt should be much shorter than 15000 chars
      expect(branchedCallParams.prompt.length).toBeLessThan(12000);
    });
  });

  describe('integration with existing functionality', () => {
    it('does not affect normal conversations (non-branched)', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create normal conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const conv = conversations.getActiveBySessionId(session.id);
      // Update model but keep the claudeSessionId
      const originalSessionId = conv.claudeSessionId;
      conversations.update(conv.id, {
        model: 'claude-opus-4-5-20251101',
        claudeSessionId: originalSessionId
      });

      const convMessages = messages.getByConversationId(conv.id);
      const userMessage = convMessages.find(m => m.role === 'user');

      // Continue with existing message on normal conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        conv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const callParams = mockQuery.mock.calls[1][0];

      // Normal conversation with claudeSessionId should resume
      expect(callParams.options.resume).toBeDefined();
      // Should not include conversation history context (it resumes instead)
      expect(callParams.prompt).not.toContain('<conversation_history>');
    });
  });

  describe('edge cases', () => {
    it('handles empty conversation history', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create original conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const originalConv = conversations.getActiveBySessionId(session.id);
      conversations.update(originalConv.id, { model: 'claude-opus-4-5-20251101' });

      // Get first message to branch from
      const convMessages = messages.getByConversationId(originalConv.id);
      const userMessage = convMessages.find(m => m.role === 'user');

      // Create branched conversation from the first message (no history before it)
      const branchedConv = conversations.branch(
        originalConv.id,
        userMessage.id,
        'Branch',
        'First message in branch'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user');

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const callParams = mockQuery.mock.calls[1][0];

      // Should still work, just without history context (no messages before branch point)
      expect(callParams.prompt).toContain('First message in branch');
    });

    it('handles branched conversation after it gets a claudeSessionId', async () => {
      session = sessions.create(project.id, 'Test Session', 'initial prompt', 'standard');

      // Create original conversation
      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await runSession(session.id, 'initial prompt', '/tmp/test', null, [], 'claude-opus-4-5-20251101');

      const originalConv = conversations.getActiveBySessionId(session.id);
      conversations.update(originalConv.id, { model: 'claude-opus-4-5-20251101' });

      // Create branched conversation
      const convMessages = messages.getByConversationId(originalConv.id);
      const userMessage = convMessages.find(m => m.role === 'user');

      const branchedConv = conversations.branch(
        originalConv.id,
        userMessage.id,
        'Branch',
        'Branch message'
      );

      const branchedMessages = messages.getByConversationId(branchedConv.id);
      const branchMessage = branchedMessages.find(m => m.role === 'user');

      // Now give the branched conversation a claudeSessionId (simulating that it was run)
      conversations.update(branchedConv.id, { claudeSessionId: 'branched-session-456' });

      mockQuery.mockImplementationOnce(() => createMockQueryResponse('claude-opus-4-5-20251101'));
      await continueSessionWithExistingMessage(
        session.id,
        branchedConv.id,
        '/tmp/test',
        null,
        'claude-opus-4-5-20251101'
      );

      const callParams = mockQuery.mock.calls[1][0];

      // Branched conversation WITH claudeSessionId should resume (not use history context)
      expect(callParams.options.resume).toBeDefined();
      expect(callParams.prompt).not.toContain('<conversation_history>');
    });
  });
});
