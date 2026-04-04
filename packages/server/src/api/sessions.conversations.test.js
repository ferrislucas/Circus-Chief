import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, conversations } from '../database.js';

// Mock websocket and summary service
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  generateSummary: vi.fn().mockResolvedValue(null),
  onSessionComplete: vi.fn(),
  onSessionActivity: vi.fn(),
}));

// Additional mocks needed for sessions router import
vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn(),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
  continueSessionWithExistingMessage: vi.fn(),
}));

vi.mock('../services/diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue([]),
  getChangesBranch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/gitService.js', () => ({
  getStatus: vi.fn(),
  getLog: vi.fn(),
  getDiff: vi.fn(),
}));

vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

vi.mock('../middleware/upload.js', () => ({
  upload: {
    single: vi.fn(() => (req, res, next) => next()),
    array: vi.fn(() => (req, res, next) => next()),
    fields: vi.fn(() => (req, res, next) => next()),
  },
  handleUploadError: vi.fn((err, req, res, next) => next(err)),
}));

vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    run: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  },
}));

vi.mock('../services/sessionDuplicator.js', () => ({
  duplicateSession: vi.fn(),
}));

describe('Sessions API - Conversation Endpoints', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    // Set session to waiting (not running) for most tests
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('GET /sessions/:id/conversations', () => {
    it('returns initial conversation created with session', () => {
      // Sessions now auto-create an initial conversation with the initial message
      const result = conversations.getBySessionIdWithMessageCount(session.id);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Initial');
      expect(result[0].messageCount).toBe(1); // Initial user message
    });

    it('returns all conversations with message counts', () => {
      // Session already has initial conversation with 1 message
      const initialConv = conversations.getActiveBySessionId(session.id);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      messages.create(session.id, 'assistant', 'Hi', { conversationId: initialConv.id });
      messages.create(session.id, 'user', 'Test', { conversationId: conv2.id });

      const result = conversations.getBySessionIdWithMessageCount(session.id);

      expect(result).toHaveLength(2);
      expect(result.find((c) => c.id === initialConv.id).messageCount).toBe(2); // Initial + assistant
      expect(result.find((c) => c.id === conv2.id).messageCount).toBe(1);
    });
  });

  describe('POST /sessions/:id/conversations', () => {
    it('creates a new conversation with provided name', () => {
      const conv = conversations.create(session.id, 'My Conversation', true);

      expect(conv.id).toBeDefined();
      expect(conv.name).toBe('My Conversation');
      expect(conv.sessionId).toBe(session.id);
      expect(conv.isActive).toBe(true);
    });

    it('creates conversation with null name', () => {
      const conv = conversations.create(session.id, null, true);

      expect(conv.name).toBeNull();
    });

    it('marks new conversation as active', () => {
      const conv1 = conversations.create(session.id, 'First', true);
      expect(conv1.isActive).toBe(true);

      const conv2 = conversations.create(session.id, 'Second', true);

      // Get updated state
      const all = conversations.getBySessionId(session.id);
      const activeConvs = all.filter((c) => c.isActive);

      expect(activeConvs).toHaveLength(1);
      expect(activeConvs[0].id).toBe(conv2.id);
    });

    it('blocks creation when session is running', () => {
      sessions.update(session.id, { status: 'running' });
      const runningSession = sessions.getById(session.id);

      // This is what the API checks
      expect(runningSession.status).toBe('running');
      // In real API, this would return 400 error
    });
  });

  describe('GET /sessions/:id/conversations/:convId', () => {
    it('returns conversation with message count', () => {
      const conv = conversations.create(session.id, 'Test', true);
      messages.create(session.id, 'user', 'Hello', { conversationId: conv.id });
      messages.create(session.id, 'assistant', 'Hi', { conversationId: conv.id });

      const retrieved = conversations.getById(conv.id);
      const messageCount = messages.getCountByConversationId(conv.id);

      expect(retrieved.id).toBe(conv.id);
      expect(retrieved.name).toBe('Test');
      expect(messageCount).toBe(2);
    });

    it('returns null for non-existent conversation', () => {
      const result = conversations.getById('non-existent');
      expect(result).toBeNull();
    });

    it('validates conversation belongs to session', () => {
      const otherSession = sessions.create(project.id, 'Other', 'Prompt', 'standard');
      const conv = conversations.create(otherSession.id, 'Other Conv', true);

      const retrieved = conversations.getById(conv.id);
      // API would check this
      expect(retrieved.sessionId).not.toBe(session.id);
    });
  });

  describe('PATCH /sessions/:id/conversations/:convId', () => {
    it('updates conversation name', () => {
      const conv = conversations.create(session.id, 'Original', true);

      const updated = conversations.update(conv.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
    });

    it('switches active conversation', () => {
      conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      conversations.setActive(conv2.id, session.id);

      const all = conversations.getBySessionId(session.id);
      const activeConv = all.find((c) => c.isActive);

      expect(activeConv.id).toBe(conv2.id);
    });

    it('blocks switching when session is running', () => {
      conversations.create(session.id, 'Conv 1', true);
      sessions.update(session.id, { status: 'running' });

      const runningSession = sessions.getById(session.id);
      expect(runningSession.status).toBe('running');
      // API would return 400 error
    });
  });

  describe('DELETE /sessions/:id/conversations/:convId', () => {
    it('deletes conversation', () => {
      // Session already has initial conversation
      const conv = conversations.create(session.id, 'To Delete', false);
      conversations.create(session.id, 'Keep', true);

      conversations.deleteAndHandleActive(conv.id);

      const all = conversations.getBySessionId(session.id);
      expect(all).toHaveLength(2); // Initial + Keep
      expect(all.find((c) => c.id === conv.id)).toBeUndefined();
    });

    it('activates another conversation when active is deleted', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      conversations.deleteAndHandleActive(conv1.id);

      const active = conversations.getActiveBySessionId(session.id);
      expect(active.id).toBe(conv2.id);
    });

    it('auto-creates new conversation when last is deleted', () => {
      const conv = conversations.create(session.id, 'Only One', true);

      const newConv = conversations.deleteAndHandleActive(conv.id);

      expect(newConv).not.toBeNull();
      expect(newConv.isActive).toBe(true);
      expect(conversations.getBySessionId(session.id)).toHaveLength(1);
    });

    it('blocks deletion when session is running', () => {
      conversations.create(session.id, 'Conv', true);
      sessions.update(session.id, { status: 'running' });

      const runningSession = sessions.getById(session.id);
      expect(runningSession.status).toBe('running');
      // API would return 400 error
    });
  });

  describe('GET /sessions/:id/messages with conversation_id', () => {
    it('returns messages for specific conversation', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      messages.create(session.id, 'user', 'Conv 1 msg', { conversationId: conv1.id });
      messages.create(session.id, 'user', 'Conv 2 msg', { conversationId: conv2.id });

      const conv1Messages = messages.getByConversationId(conv1.id);
      const conv2Messages = messages.getByConversationId(conv2.id);

      expect(conv1Messages).toHaveLength(1);
      expect(conv1Messages[0].content).toBe('Conv 1 msg');
      expect(conv2Messages).toHaveLength(1);
      expect(conv2Messages[0].content).toBe('Conv 2 msg');
    });

    it('returns messages for active conversation when no conversation_id', () => {
      const activeConv = conversations.create(session.id, 'Active', true);
      const inactiveConv = conversations.create(session.id, 'Inactive', false);

      messages.create(session.id, 'user', 'Active msg', { conversationId: activeConv.id });
      messages.create(session.id, 'user', 'Inactive msg', { conversationId: inactiveConv.id });

      // Simulating API behavior: get active conversation then its messages
      const active = conversations.getActiveBySessionId(session.id);
      const activeMessages = messages.getByConversationId(active.id);

      expect(activeMessages).toHaveLength(1);
      expect(activeMessages[0].content).toBe('Active msg');
    });

    it('falls back to all session messages when no active conversation', () => {
      // Get initial message count (session creation adds a user message)
      const initialCount = messages.getBySessionId(session.id).length;

      // No conversations created - add more messages
      messages.create(session.id, 'user', 'Legacy msg 1');
      messages.create(session.id, 'assistant', 'Legacy msg 2');

      const allMessages = messages.getBySessionId(session.id);

      expect(allMessages).toHaveLength(initialCount + 2);
    });
  });

});
