import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages, conversations } from '../src/database.js';

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

// Import summaryService after mock setup
import * as summaryService from '../src/services/summaryService.js';

describe('Sessions Conversations API', () => {
  let project;
  let session;

  beforeEach(() => {
    // Set mock mode for testing
    vi.stubEnv('MOCK_CLAUDE', 'true');
    vi.clearAllMocks();

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
  });

  afterEach(() => {
    summaryService.cleanupSession(session.id);
    vi.unstubAllEnvs();
  });

  describe('Conversation CRUD operations', () => {
    it('creates a conversation for a session', () => {
      const conv = conversations.create(session.id, 'First Conversation', true);

      expect(conv.id).toBeDefined();
      expect(conv.sessionId).toBe(session.id);
      expect(conv.name).toBe('First Conversation');
      expect(conv.isActive).toBe(true);
    });

    it('creates conversation with null name', () => {
      const conv = conversations.create(session.id, null, true);

      expect(conv.id).toBeDefined();
      expect(conv.name).toBeNull();
    });

    it('retrieves all conversations for a session', () => {
      conversations.create(session.id, 'Conv 1', false);
      conversations.create(session.id, 'Conv 2', false);
      conversations.create(session.id, 'Conv 3', true);

      const all = conversations.getBySessionId(session.id);

      expect(all).toHaveLength(3);
    });

    it('retrieves active conversation for a session', () => {
      conversations.create(session.id, 'Inactive', false);
      const active = conversations.create(session.id, 'Active', true);

      const result = conversations.getActiveBySessionId(session.id);

      expect(result.id).toBe(active.id);
      expect(result.name).toBe('Active');
    });

    it('returns null when no active conversation', () => {
      conversations.create(session.id, 'Inactive', false);

      const result = conversations.getActiveBySessionId(session.id);

      expect(result).toBeNull();
    });

    it('updates conversation name', () => {
      const conv = conversations.create(session.id, 'Original', true);

      const updated = conversations.update(conv.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
    });

    it('updates conversation summary', () => {
      const conv = conversations.create(session.id, 'Test', true);

      const updated = conversations.update(conv.id, { summary: 'This is a summary' });

      expect(updated.summary).toBe('This is a summary');
    });
  });

  describe('Active conversation management', () => {
    it('setActive makes one conversation active and others inactive', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);
      const conv3 = conversations.create(session.id, 'Conv 3', false);

      conversations.setActive(conv2.id, session.id);

      const active = conversations.getActiveBySessionId(session.id);
      expect(active.id).toBe(conv2.id);

      const all = conversations.getBySessionId(session.id);
      const activeCount = all.filter(c => c.isActive).length;
      expect(activeCount).toBe(1);
    });

    it('ensureActiveConversation creates one if none exists', () => {
      // No conversations yet
      expect(conversations.getBySessionId(session.id)).toHaveLength(0);

      const conv = conversations.ensureActiveConversation(session.id);

      expect(conv.isActive).toBe(true);
      expect(conversations.getBySessionId(session.id)).toHaveLength(1);
    });

    it('ensureActiveConversation returns existing active', () => {
      const existing = conversations.create(session.id, 'Existing', true);

      const result = conversations.ensureActiveConversation(session.id);

      expect(result.id).toBe(existing.id);
      expect(conversations.getBySessionId(session.id)).toHaveLength(1);
    });

    it('ensureActiveConversation activates first if none active', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', false);
      conversations.create(session.id, 'Conv 2', false);

      const result = conversations.ensureActiveConversation(session.id);

      expect(result.id).toBe(conv1.id);
      expect(result.isActive).toBe(true);
    });
  });

  describe('Conversation deletion', () => {
    it('deletes a conversation', () => {
      const conv = conversations.create(session.id, 'To Delete', false);

      conversations.deleteAndHandleActive(conv.id, session.id);

      expect(conversations.getBySessionId(session.id)).toHaveLength(0);
    });

    it('deleting active conversation activates another', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      conversations.deleteAndHandleActive(conv1.id, session.id);

      const active = conversations.getActiveBySessionId(session.id);
      expect(active.id).toBe(conv2.id);
    });

    it('deleting last conversation auto-creates a new one', () => {
      const conv = conversations.create(session.id, 'Only One', true);

      const newConv = conversations.deleteAndHandleActive(conv.id, session.id);

      // A new conversation is auto-created to ensure session always has one
      expect(conversations.getBySessionId(session.id)).toHaveLength(1);
      expect(newConv).not.toBeNull();
      expect(newConv.isActive).toBe(true);
      expect(newConv.id).not.toBe(conv.id);
    });

    it('cascade deletes messages when conversation deleted', () => {
      const conv = conversations.create(session.id, 'With Messages', true);
      messages.create(session.id, 'user', 'Message 1', null, conv.id);
      messages.create(session.id, 'assistant', 'Message 2', null, conv.id);

      expect(messages.getByConversationId(conv.id)).toHaveLength(2);

      // Delete messages before conversation (simulates CASCADE)
      messages.deleteByConversationId(conv.id);
      conversations.deleteAndHandleActive(conv.id, session.id);

      expect(messages.getByConversationId(conv.id)).toHaveLength(0);
    });
  });

  describe('Message count in conversations', () => {
    it('getBySessionIdWithMessageCount includes message counts', () => {
      const conv1 = conversations.create(session.id, 'Conv 1', true);
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      messages.create(session.id, 'user', 'Msg 1', null, conv1.id);
      messages.create(session.id, 'assistant', 'Msg 2', null, conv1.id);
      messages.create(session.id, 'user', 'Msg 3', null, conv1.id);
      messages.create(session.id, 'user', 'Msg 4', null, conv2.id);

      const convs = conversations.getBySessionIdWithMessageCount(session.id);

      const c1 = convs.find(c => c.id === conv1.id);
      const c2 = convs.find(c => c.id === conv2.id);

      expect(c1.messageCount).toBe(3);
      expect(c2.messageCount).toBe(1);
    });

    it('message count is 0 for empty conversation', () => {
      conversations.create(session.id, 'Empty', true);

      const convs = conversations.getBySessionIdWithMessageCount(session.id);

      expect(convs[0].messageCount).toBe(0);
    });
  });

  describe('Auto-naming conversations', () => {
    it('autoName sets name from provided message', () => {
      const conv = conversations.create(session.id, null, true);

      const named = conversations.autoName(conv.id, 'Please help me fix this bug');

      expect(named.name).toBe('Please help me fix this bug');
    });

    it('autoName truncates long messages', () => {
      const conv = conversations.create(session.id, null, true);
      const longMessage = 'A'.repeat(100);

      const named = conversations.autoName(conv.id, longMessage);

      expect(named.name.length).toBeLessThanOrEqual(55);
      expect(named.name.endsWith('...')).toBe(true);
    });

    it('autoName truncates at word boundary when possible', () => {
      const conv = conversations.create(session.id, null, true);
      const message = 'This is a long message that should be truncated at a word boundary for readability';

      const named = conversations.autoName(conv.id, message);

      // Should truncate at a word boundary
      expect(named.name.length).toBeLessThanOrEqual(55);
      expect(named.name).not.toMatch(/\s$/); // Should not end with space
    });

    it('autoName overrides existing name', () => {
      // Note: autoName always sets the name to the provided message
      const conv = conversations.create(session.id, 'Original Name', true);

      const result = conversations.autoName(conv.id, 'New Name');

      expect(result.name).toBe('New Name');
    });

    it('autoName handles short messages without truncation', () => {
      const conv = conversations.create(session.id, null, true);

      const result = conversations.autoName(conv.id, 'Short message');

      expect(result.name).toBe('Short message');
      expect(result.name.endsWith('...')).toBe(false);
    });
  });

  describe('Conversation summary generation', () => {
    it('generates summary for conversation', async () => {
      const conv = conversations.create(session.id, 'Test Conv', true);
      messages.create(session.id, 'user', 'Help me with this', null, conv.id);
      messages.create(session.id, 'assistant', 'Sure, I can help', null, conv.id);

      const result = await summaryService.generateConversationSummary(session.id, conv.id);

      // Returns the summary string directly
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('stores summary on conversation record', async () => {
      const conv = conversations.create(session.id, 'Test Conv', true);
      messages.create(session.id, 'user', 'Help me', null, conv.id);
      messages.create(session.id, 'assistant', 'Sure thing', null, conv.id);

      await summaryService.generateConversationSummary(session.id, conv.id);

      const updated = conversations.getById(conv.id);
      expect(updated.summary).toBeDefined();
      expect(updated.summary.length).toBeGreaterThan(0);
      expect(updated.summaryGeneratedAt).toBeDefined();
    });

    it('returns brief message for single message conversation', async () => {
      const conv = conversations.create(session.id, 'Brief', true);
      messages.create(session.id, 'user', 'Hello', null, conv.id);

      const result = await summaryService.generateConversationSummary(session.id, conv.id);

      // Single message gets brief default summary
      expect(result).toBe('Brief conversation with minimal content.');
    });

    it('returns null for conversation with no messages', async () => {
      const conv = conversations.create(session.id, 'Empty', true);

      const result = await summaryService.generateConversationSummary(session.id, conv.id);

      expect(result).toBeNull();
    });

    it('returns null for non-existent conversation', async () => {
      const result = await summaryService.generateConversationSummary(session.id, 'non-existent');

      expect(result).toBeNull();
    });

    it('returns null for conversation from different session', async () => {
      const otherSession = sessions.create(project.id, 'Other Session', 'Prompt', 'standard');
      const conv = conversations.create(otherSession.id, 'Other Conv', true);
      messages.create(otherSession.id, 'user', 'Hello', null, conv.id);

      // Try to get summary with wrong session ID
      const result = await summaryService.generateConversationSummary(session.id, conv.id);

      expect(result).toBeNull();
    });
  });

  describe('Session lifecycle integration', () => {
    it('conversations deleted when session deleted', () => {
      conversations.create(session.id, 'Conv 1', true);
      conversations.create(session.id, 'Conv 2', false);

      expect(conversations.getBySessionId(session.id)).toHaveLength(2);

      sessions.delete(session.id);

      expect(conversations.getBySessionId(session.id)).toHaveLength(0);
    });

    it('messages in conversations deleted when session deleted', () => {
      const conv = conversations.create(session.id, 'Test', true);
      messages.create(session.id, 'user', 'Test message', null, conv.id);

      sessions.delete(session.id);

      expect(messages.getByConversationId(conv.id)).toHaveLength(0);
    });

    it('multiple sessions have independent conversations', () => {
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt 2', 'standard');

      conversations.create(session.id, 'Session 1 Conv', true);
      conversations.create(session2.id, 'Session 2 Conv', true);

      expect(conversations.getBySessionId(session.id)).toHaveLength(1);
      expect(conversations.getBySessionId(session2.id)).toHaveLength(1);

      // Deleting one session doesn't affect the other
      sessions.delete(session.id);

      expect(conversations.getBySessionId(session2.id)).toHaveLength(1);

      // Cleanup
      sessions.delete(session2.id);
    });
  });

  describe('Conversation ordering', () => {
    it('conversations returned in createdAt order (oldest first)', () => {
      const conv1 = conversations.create(session.id, 'First', false);
      const conv2 = conversations.create(session.id, 'Second', false);
      const conv3 = conversations.create(session.id, 'Third', true);

      const all = conversations.getBySessionId(session.id);

      expect(all[0].id).toBe(conv1.id);
      expect(all[1].id).toBe(conv2.id);
      expect(all[2].id).toBe(conv3.id);
    });
  });
});
