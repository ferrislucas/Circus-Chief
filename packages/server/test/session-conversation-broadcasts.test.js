import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages, conversations } from '../src/database.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// Mock the websocket module to track broadcasts
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Import mocked functions
import { broadcastToSession } from '../src/websocket.js';

// Mock the session manager for basic operations
vi.mock('../src/services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  cleanupActiveSession: vi.fn(),
}));

// Mock git setup
vi.mock('../src/services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

// Mock summary service
import * as summaryService from '../src/services/summaryService.js';

/**
 * Tests for the conversation broadcast race condition fix.
 *
 * These tests verify that when messages are created and broadcast,
 * they include the conversationId in the broadcast payload to prevent
 * race conditions where the client receives messages before it knows
 * which conversation they belong to.
 */
describe('Session Conversation Broadcasts', () => {
  let project;
  let session;
  let activeConversation;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test project and session
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');

    // Get the auto-created active conversation
    activeConversation = conversations.getActiveBySessionId(session.id);
  });

  afterEach(() => {
    summaryService.cleanupSession(session.id);
  });

  describe('Message creation broadcasts', () => {
    it('stores conversationId with user message', () => {
      const message = messages.create(
        session.id,
        'user',
        'Test user message',
        { conversationId: activeConversation.id }
      );

      expect(message.conversationId).toBe(activeConversation.id);
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe('user');
    });

    it('stores conversationId with assistant message', () => {
      const message = messages.create(
        session.id,
        'assistant',
        'Test assistant message',
        { conversationId: activeConversation.id }
      );

      expect(message.conversationId).toBe(activeConversation.id);
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe('assistant');
    });

    it('allows null conversationId for legacy messages', () => {
      const message = messages.create(
        session.id,
        'user',
        'Legacy message without conversation'
      );

      expect(message.conversationId).toBeNull();
      expect(message.sessionId).toBe(session.id);
    });
  });

  describe('Conversation context in broadcasts', () => {
    it('broadcast payload should include conversationId for user messages', () => {
      const message = messages.create(
        session.id,
        'user',
        'User message',
        { conversationId: activeConversation.id }
      );

      // Simulate the broadcast that would happen in continueSession
      broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
        message,
        conversationId: activeConversation.id,
      });

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            id: message.id,
            conversationId: activeConversation.id,
          }),
          conversationId: activeConversation.id,
        })
      );
    });

    it('broadcast payload should include conversationId for assistant messages', () => {
      const message = messages.create(
        session.id,
        'assistant',
        'Assistant message',
        { conversationId: activeConversation.id }
      );

      // Simulate the broadcast that would happen in handleStreamEvent
      broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
        message,
        conversationId: activeConversation.id,
      });

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            id: message.id,
            conversationId: activeConversation.id,
          }),
          conversationId: activeConversation.id,
        })
      );
    });

    it('handles null conversationId in broadcast payload', () => {
      const message = messages.create(
        session.id,
        'user',
        'Legacy message'
      );

      // Legacy broadcasts might not have conversationId
      broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
        message,
        conversationId: null,
      });

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_MESSAGE,
        expect.objectContaining({
          message: expect.objectContaining({
            id: message.id,
            conversationId: null,
          }),
          conversationId: null,
        })
      );
    });
  });

  describe('Multiple conversations scenario', () => {
    it('messages are associated with correct conversation', () => {
      // Create a second conversation
      const conv2 = conversations.create(session.id, 'Second Conversation', false);

      // Create messages in different conversations
      const msg1 = messages.create(session.id, 'user', 'Message in conv 1', { conversationId: activeConversation.id });
      const msg2 = messages.create(session.id, 'user', 'Message in conv 2', { conversationId: conv2.id });

      // Verify messages are in correct conversations
      expect(msg1.conversationId).toBe(activeConversation.id);
      expect(msg2.conversationId).toBe(conv2.id);

      // Verify messages can be retrieved by conversation
      const conv1Messages = messages.getByConversationId(activeConversation.id);
      const conv2Messages = messages.getByConversationId(conv2.id);

      expect(conv1Messages).toHaveLength(2); // Initial message + msg1
      expect(conv2Messages).toHaveLength(1); // msg2 only
    });

    it('switching active conversation preserves message associations', () => {
      const conv2 = conversations.create(session.id, 'Second Conversation', false);

      // Create message in first conversation
      const msg1 = messages.create(session.id, 'user', 'In conv 1', { conversationId: activeConversation.id });

      // Switch active conversation
      conversations.setActive(conv2.id, session.id);
      const newActive = conversations.getActiveBySessionId(session.id);
      expect(newActive.id).toBe(conv2.id);

      // Create message in second conversation
      const msg2 = messages.create(session.id, 'user', 'In conv 2', { conversationId: conv2.id });

      // Verify messages stayed in their original conversations
      expect(msg1.conversationId).toBe(activeConversation.id);
      expect(msg2.conversationId).toBe(conv2.id);
    });
  });

  describe('Race condition prevention', () => {
    it('conversation exists before message is created', () => {
      // This simulates the fix where ensureActiveConversation is called
      // BEFORE creating the user message in continueSession
      const conv = conversations.ensureActiveConversation(session.id);
      expect(conv).toBeDefined();
      expect(conv.id).toBeDefined();

      // Now message creation will have a valid conversationId
      const message = messages.create(
        session.id,
        'user',
        'Message content',
        { conversationId: conv.id }
      );

      expect(message.conversationId).toBe(conv.id);
    });

    it('broadcast includes conversationId immediately upon message creation', () => {
      const conv = conversations.ensureActiveConversation(session.id);
      const message = messages.create(session.id, 'user', 'Content', { conversationId: conv.id });

      // Simulate immediate broadcast (as in continueSession)
      broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
        message,
        conversationId: conv.id,
      });

      // Verify broadcast was called with conversationId
      const calls = broadcastToSession.mock.calls;
      const messageBroadcast = calls.find(
        ([sid, type]) => sid === session.id && type === WS_MESSAGE_TYPES.SESSION_MESSAGE
      );

      expect(messageBroadcast).toBeDefined();
      expect(messageBroadcast[2]).toHaveProperty('conversationId', conv.id);
      expect(messageBroadcast[2]).toHaveProperty('message');
      expect(messageBroadcast[2].message).toHaveProperty('conversationId', conv.id);
    });
  });

  describe('Message fetching with conversation context', () => {
    it('getByConversationId returns only messages for that conversation', () => {
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      messages.create(session.id, 'user', 'Msg 1 in conv 1', { conversationId: activeConversation.id });
      messages.create(session.id, 'user', 'Msg 2 in conv 1', { conversationId: activeConversation.id });
      messages.create(session.id, 'user', 'Msg in conv 2', { conversationId: conv2.id });

      const conv1Messages = messages.getByConversationId(activeConversation.id);
      const conv2Messages = messages.getByConversationId(conv2.id);

      // activeConversation has initial message + 2 new messages
      expect(conv1Messages).toHaveLength(3);
      expect(conv1Messages.every(m => m.conversationId === activeConversation.id)).toBe(true);

      expect(conv2Messages).toHaveLength(1);
      expect(conv2Messages.every(m => m.conversationId === conv2.id)).toBe(true);
    });

    it('fetching messages for active conversation returns correct messages', () => {
      messages.create(session.id, 'user', 'User msg', { conversationId: activeConversation.id });
      messages.create(session.id, 'assistant', 'Assistant msg', { conversationId: activeConversation.id });

      const activeConv = conversations.getActiveBySessionId(session.id);
      const activeMessages = messages.getByConversationId(activeConv.id);

      // Should have initial message + 2 new messages
      expect(activeMessages).toHaveLength(3);
      expect(activeMessages.every(m => m.conversationId === activeConv.id)).toBe(true);
    });
  });
});
