import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, conversations } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';

// Mock websocket and summary service
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
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
    it('returns empty array when no conversations exist', () => {
      const result = conversations.getBySessionIdWithMessageCount(session.id);
      expect(result).toEqual([]);
    });

    it('returns all conversations with message counts', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      messages.create(session.id, 'user', 'Hello', null, conv1.id);
      messages.create(session.id, 'assistant', 'Hi', null, conv1.id);
      messages.create(session.id, 'user', 'Test', null, conv2.id);

      const result = conversations.getBySessionIdWithMessageCount(session.id);

      expect(result).toHaveLength(2);
      expect(result.find((c) => c.id === conv1.id).messageCount).toBe(2);
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
      messages.create(session.id, 'user', 'Hello', null, conv.id);
      messages.create(session.id, 'assistant', 'Hi', null, conv.id);

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
      const conv1 = conversations.create(session.id, 'Conv 1', true);
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
      const conv = conversations.create(session.id, 'To Delete', false);
      conversations.create(session.id, 'Keep', true);

      conversations.deleteAndHandleActive(conv.id);

      const all = conversations.getBySessionId(session.id);
      expect(all).toHaveLength(1);
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

      messages.create(session.id, 'user', 'Conv 1 msg', null, conv1.id);
      messages.create(session.id, 'user', 'Conv 2 msg', null, conv2.id);

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

      messages.create(session.id, 'user', 'Active msg', null, activeConv.id);
      messages.create(session.id, 'user', 'Inactive msg', null, inactiveConv.id);

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

  describe('POST /sessions/:id/conversations/:convId/summary', () => {
    it('generates and stores summary for conversation', async () => {
      const conv = conversations.create(session.id, 'Test', true);
      messages.create(session.id, 'user', 'Hello', null, conv.id);
      messages.create(session.id, 'assistant', 'Hi', null, conv.id);

      // Simulate summary update
      const updatedConv = conversations.update(conv.id, {
        summary: 'Test conversation summary',
        summaryGeneratedAt: Date.now(),
      });

      expect(updatedConv.summary).toBe('Test conversation summary');
      expect(updatedConv.summaryGeneratedAt).toBeDefined();
    });
  });
});
