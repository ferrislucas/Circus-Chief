import { describe, it, expect, beforeEach } from 'vitest';
import { MessageRepository } from './MessageRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('MessageRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let convRepo;
  let sessionId;
  let conversationId;

  beforeEach(() => {
    repo = new MessageRepository();
    projectRepo = new ProjectRepository();
    convRepo = new ConversationRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;

    // Create a conversation for testing
    const conversation = convRepo.create(sessionId, 'Test Conversation', true);
    conversationId = conversation.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(MessageRepository);
      expect(repo.tableName).toBe('conversation_messages');
    });
  });

  describe('create', () => {
    it('creates a message with role and content', () => {
      const message = repo.create(sessionId, 'user', 'Hello, world!');

      expect(message.id).toBeDefined();
      expect(message.sessionId).toBe(sessionId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.timestamp).toBeTypeOf('number');
    });

    it('creates message with null toolUse by default', () => {
      const message = repo.create(sessionId, 'assistant', 'Response');
      expect(message.toolUse).toBeNull();
    });

    it('creates message with toolUse as JSON', () => {
      const toolUse = [{ name: 'bash', input: { command: 'ls -la' } }];
      const message = repo.create(sessionId, 'assistant', 'Running command...', { toolUse });

      expect(message.toolUse).toEqual(toolUse);
    });

    it('handles complex toolUse objects', () => {
      const toolUse = [
        { name: 'read', input: { path: '/tmp/file.txt' } },
        { name: 'write', input: { path: '/tmp/out.txt', content: 'data' } },
      ];
      const message = repo.create(sessionId, 'assistant', 'Processing...', { toolUse });

      expect(message.toolUse).toEqual(toolUse);
    });
  });

  describe('getById', () => {
    it('retrieves message by ID', () => {
      const created = repo.create(sessionId, 'user', 'Test message');
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns empty array when no messages exist', () => {
      const messages = repo.getBySessionId(sessionId);
      expect(messages).toEqual([]);
    });

    it('returns all messages for a session', () => {
      repo.create(sessionId, 'user', 'Message 1');
      repo.create(sessionId, 'assistant', 'Message 2');
      repo.create(sessionId, 'user', 'Message 3');

      const messages = repo.getBySessionId(sessionId);

      expect(messages).toHaveLength(3);
    });

    it('returns messages in chronological order (ASC)', () => {
      repo.create(sessionId, 'user', 'First');
      repo.create(sessionId, 'assistant', 'Second');
      repo.create(sessionId, 'user', 'Third');

      const messages = repo.getBySessionId(sessionId);

      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('does not return messages from other sessions', () => {
      // Create another session
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      repo.create(sessionId, 'user', 'Session 1 message');
      repo.create(otherId, 'user', 'Session 2 message');

      const messages = repo.getBySessionId(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Session 1 message');
    });
  });

  describe('create with conversationId', () => {
    it('creates a message with conversationId', () => {
      const message = repo.create(sessionId, 'user', 'Hello!', { conversationId });

      expect(message.conversationId).toBe(conversationId);
      expect(message.sessionId).toBe(sessionId);
    });

    it('creates a message with null conversationId by default', () => {
      const message = repo.create(sessionId, 'user', 'Hello!');

      expect(message.conversationId).toBeNull();
    });

    it('creates a message with both toolUse and conversationId', () => {
      const toolUse = [{ name: 'read', input: { path: '/tmp/file.txt' } }];
      const message = repo.create(sessionId, 'assistant', 'Reading...', { toolUse, conversationId });

      expect(message.toolUse).toEqual(toolUse);
      expect(message.conversationId).toBe(conversationId);
    });
  });

  describe('create with model', () => {
    it('creates a message with model', () => {
      const message = repo.create(sessionId, 'assistant', 'Response', { model: 'claude-opus-4-6' });

      expect(message.model).toBe('claude-opus-4-6');
      expect(message.role).toBe('assistant');
    });

    it('creates a message with null model by default', () => {
      const message = repo.create(sessionId, 'assistant', 'Response');

      expect(message.model).toBeNull();
    });

    it('creates a message with model and conversationId', () => {
      const message = repo.create(sessionId, 'assistant', 'Response', { conversationId, model: 'claude-haiku-4-5-20251001' });

      expect(message.model).toBe('claude-haiku-4-5-20251001');
      expect(message.conversationId).toBe(conversationId);
    });

    it('creates a message with all parameters including model', () => {
      const toolUse = [{ name: 'bash', input: { command: 'ls' } }];
      const message = repo.create(sessionId, 'assistant', 'Running command', { toolUse, conversationId, model: 'claude-sonnet-4-6' });

      expect(message.model).toBe('claude-sonnet-4-6');
      expect(message.toolUse).toEqual(toolUse);
      expect(message.conversationId).toBe(conversationId);
      expect(message.role).toBe('assistant');
    });

    it('preserves model when retrieving message by ID', () => {
      const created = repo.create(sessionId, 'assistant', 'Response', { model: 'claude-opus-4-6' });
      const retrieved = repo.getById(created.id);

      expect(retrieved.model).toBe('claude-opus-4-6');
      expect(retrieved.content).toBe('Response');
    });

    it('includes model in messages retrieved by session', () => {
      repo.create(sessionId, 'user', 'Question');
      repo.create(sessionId, 'assistant', 'Answer', { model: 'claude-opus-4-6' });

      const messages = repo.getBySessionId(sessionId);

      expect(messages).toHaveLength(2);
      expect(messages[0].model).toBeNull(); // User messages don't have model
      expect(messages[1].model).toBe('claude-opus-4-6');
    });

    it('includes model in messages retrieved by conversation', () => {
      repo.create(sessionId, 'user', 'Question', { conversationId });
      repo.create(sessionId, 'assistant', 'Answer 1', { conversationId, model: 'claude-opus-4-6' });
      repo.create(sessionId, 'assistant', 'Answer 2', { conversationId, model: 'claude-haiku-4-5-20251001' });

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(3);
      expect(messages[1].model).toBe('claude-opus-4-6');
      expect(messages[2].model).toBe('claude-haiku-4-5-20251001');
    });

    it('preserves model when duplicating messages for conversation', () => {
      const sourceConv = convRepo.create(sessionId, 'Source Conversation');
      const targetConv = convRepo.create(sessionId, 'Target Conversation');

      repo.create(sessionId, 'user', 'Question', { conversationId: sourceConv.id });
      repo.create(sessionId, 'assistant', 'Answer', { conversationId: sourceConv.id, model: 'claude-opus-4-6' });

      const mapping = new Map([[sourceConv.id, targetConv.id]]);
      repo.duplicateForConversations(mapping, sessionId);

      const targetMessages = repo.getByConversationId(targetConv.id);

      expect(targetMessages).toHaveLength(2);
      expect(targetMessages[1].model).toBe('claude-opus-4-6');
    });
  });

  describe('getByConversationId', () => {
    it('returns empty array when no messages exist', () => {
      const messages = repo.getByConversationId(conversationId);
      expect(messages).toEqual([]);
    });

    it('returns all messages for a conversation', () => {
      repo.create(sessionId, 'user', 'Message 1', { conversationId });
      repo.create(sessionId, 'assistant', 'Message 2', { conversationId });
      repo.create(sessionId, 'user', 'Message 3', { conversationId });

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(3);
    });

    it('returns messages in chronological order (ASC)', () => {
      repo.create(sessionId, 'user', 'First', { conversationId });
      repo.create(sessionId, 'assistant', 'Second', { conversationId });
      repo.create(sessionId, 'user', 'Third', { conversationId });

      const messages = repo.getByConversationId(conversationId);

      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('does not return messages from other conversations', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1 message', { conversationId });
      repo.create(sessionId, 'user', 'Conv 2 message', { conversationId: otherConv.id });

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Conv 1 message');
    });

    it('does not return messages without conversationId', () => {
      repo.create(sessionId, 'user', 'With conv', { conversationId });
      repo.create(sessionId, 'user', 'Without conv');

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('With conv');
    });
  });

  describe('getCountByConversationId', () => {
    it('returns 0 when no messages exist', () => {
      const count = repo.getCountByConversationId(conversationId);
      expect(count).toBe(0);
    });

    it('returns correct count for conversation', () => {
      repo.create(sessionId, 'user', 'Message 1', { conversationId });
      repo.create(sessionId, 'assistant', 'Message 2', { conversationId });
      repo.create(sessionId, 'user', 'Message 3', { conversationId });

      const count = repo.getCountByConversationId(conversationId);

      expect(count).toBe(3);
    });

    it('only counts messages for specified conversation', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1', { conversationId });
      repo.create(sessionId, 'user', 'Conv 1 again', { conversationId });
      repo.create(sessionId, 'user', 'Conv 2', { conversationId: otherConv.id });

      expect(repo.getCountByConversationId(conversationId)).toBe(2);
      expect(repo.getCountByConversationId(otherConv.id)).toBe(1);
    });
  });

  describe('deleteByConversationId', () => {
    it('deletes all messages for a conversation', () => {
      repo.create(sessionId, 'user', 'Message 1', { conversationId });
      repo.create(sessionId, 'assistant', 'Message 2', { conversationId });

      expect(repo.getByConversationId(conversationId)).toHaveLength(2);

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
    });

    it('does not delete messages from other conversations', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1 message', { conversationId });
      repo.create(sessionId, 'user', 'Conv 2 message', { conversationId: otherConv.id });

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
      expect(repo.getByConversationId(otherConv.id)).toHaveLength(1);
    });

    it('does not throw when no messages exist', () => {
      expect(() => repo.deleteByConversationId(conversationId)).not.toThrow();
    });

    it('does not affect messages without conversationId', () => {
      repo.create(sessionId, 'user', 'With conv', { conversationId });
      repo.create(sessionId, 'user', 'Without conv');

      repo.deleteByConversationId(conversationId);

      const allMessages = repo.getBySessionId(sessionId);
      expect(allMessages).toHaveLength(1);
      expect(allMessages[0].content).toBe('Without conv');
    });
  });

  describe('updateContent', () => {
    it('updates message content successfully', () => {
      const message = repo.create(sessionId, 'user', 'Original content');
      const updated = repo.updateContent(message.id, 'Updated content');

      expect(updated.content).toBe('Updated content');
      expect(updated.id).toBe(message.id);
      expect(updated.role).toBe('user');
      expect(updated.sessionId).toBe(sessionId);
    });

    it('persists content update in database', () => {
      const message = repo.create(sessionId, 'user', 'Original');
      repo.updateContent(message.id, 'Updated');

      const retrieved = repo.getById(message.id);
      expect(retrieved.content).toBe('Updated');
    });

    it('returns updated message with all fields intact', () => {
      const message = repo.create(sessionId, 'assistant', 'Original response', { conversationId });
      const updated = repo.updateContent(message.id, 'New response');

      expect(updated.id).toBe(message.id);
      expect(updated.role).toBe('assistant');
      expect(updated.sessionId).toBe(sessionId);
      expect(updated.conversationId).toBe(conversationId);
      expect(updated.content).toBe('New response');
    });

    it('rejects empty string prompt', () => {
      const message = repo.create(sessionId, 'user', 'Original');
      expect(() => repo.updateContent(message.id, '')).toThrow('Message content cannot be empty');
    });

    it('rejects whitespace-only prompt', () => {
      const message = repo.create(sessionId, 'user', 'Original');
      expect(() => repo.updateContent(message.id, '   ')).toThrow('Message content cannot be empty');
      expect(() => repo.updateContent(message.id, '\t\n')).toThrow('Message content cannot be empty');
    });

    it('rejects null or undefined prompt', () => {
      const message = repo.create(sessionId, 'user', 'Original');
      expect(() => repo.updateContent(message.id, null)).toThrow('Message content cannot be empty');
      expect(() => repo.updateContent(message.id, undefined)).toThrow('Message content cannot be empty');
    });

    it('preserves other message fields on update', () => {
      const toolUse = [{ name: 'bash', input: { command: 'ls -la' } }];
      const message = repo.create(sessionId, 'assistant', 'Original', { toolUse, conversationId });
      const updated = repo.updateContent(message.id, 'New content');

      // Note: toolUse is not updated by this method, only content
      expect(updated.role).toBe(message.role);
      expect(updated.sessionId).toBe(message.sessionId);
      expect(updated.conversationId).toBe(message.conversationId);
      expect(updated.timestamp).toBe(message.timestamp);
    });

    it('handles non-existent message gracefully', () => {
      // Should not throw, but update will not find anything
      const updated = repo.updateContent('non-existent-id', 'New content');
      expect(updated).toBeNull();
    });

    it('allows very long content', () => {
      const message = repo.create(sessionId, 'user', 'Short');
      const longContent = 'a'.repeat(10000);
      const updated = repo.updateContent(message.id, longContent);

      expect(updated.content).toBe(longContent);
      expect(updated.content.length).toBe(10000);
    });

    it('handles special characters in content', () => {
      const message = repo.create(sessionId, 'user', 'Original');
      const specialContent = 'Content with "quotes", \'single quotes\', \n newlines, \t tabs, and unicode: 你好';
      const updated = repo.updateContent(message.id, specialContent);

      expect(updated.content).toBe(specialContent);
    });

    it('allows updating to same content', () => {
      const message = repo.create(sessionId, 'user', 'Content');
      const updated = repo.updateContent(message.id, 'Content');

      expect(updated.content).toBe('Content');
    });

    it('multiple consecutive updates work correctly', () => {
      const message = repo.create(sessionId, 'user', 'Version 1');

      let updated = repo.updateContent(message.id, 'Version 2');
      expect(updated.content).toBe('Version 2');

      updated = repo.updateContent(message.id, 'Version 3');
      expect(updated.content).toBe('Version 3');

      updated = repo.updateContent(message.id, 'Version 4');
      expect(updated.content).toBe('Version 4');

      const final = repo.getById(message.id);
      expect(final.content).toBe('Version 4');
    });
  });

  describe('create with options object signature', () => {
    it('creates a message with options object containing toolUse', () => {
      const toolUse = [{ name: 'bash', input: { command: 'ls' } }];
      const message = repo.create(sessionId, 'assistant', 'Running...', { toolUse });

      expect(message.toolUse).toEqual(toolUse);
      expect(message.conversationId).toBeNull();
      expect(message.model).toBeNull();
    });

    it('creates a message with options object containing conversationId', () => {
      const message = repo.create(sessionId, 'user', 'Hello!', { conversationId });

      expect(message.conversationId).toBe(conversationId);
      expect(message.toolUse).toBeNull();
      expect(message.model).toBeNull();
    });

    it('creates a message with options object containing model', () => {
      const message = repo.create(sessionId, 'assistant', 'Response', { model: 'claude-opus-4-6' });

      expect(message.model).toBe('claude-opus-4-6');
      expect(message.toolUse).toBeNull();
      expect(message.conversationId).toBeNull();
    });

    it('creates a message with all options', () => {
      const toolUse = [{ name: 'read', input: { path: '/tmp/file' } }];
      const message = repo.create(sessionId, 'assistant', 'Processing...', {
        toolUse,
        conversationId,
        model: 'claude-sonnet-4-6',
      });

      expect(message.toolUse).toEqual(toolUse);
      expect(message.conversationId).toBe(conversationId);
      expect(message.model).toBe('claude-sonnet-4-6');
    });

    it('creates a message with empty options object (all defaults)', () => {
      const message = repo.create(sessionId, 'user', 'Hello!', {});

      expect(message.toolUse).toBeNull();
      expect(message.conversationId).toBeNull();
      expect(message.model).toBeNull();
    });

    it('creates a message with null toolUse in options', () => {
      const message = repo.create(sessionId, 'user', 'Hello!', { toolUse: null, conversationId });

      expect(message.toolUse).toBeNull();
      expect(message.conversationId).toBe(conversationId);
    });

  });

  describe('duplicateForConversations', () => {
    it('should copy all messages to new conversations', () => {
      // Create two conversations with messages for this session
      const sourceConv1 = convRepo.create(sessionId, 'Conv 1');
      const sourceConv2 = convRepo.create(sessionId, 'Conv 2');

      repo.create(sessionId, 'user', 'Question?', { conversationId: sourceConv1.id });
      repo.create(sessionId, 'assistant', 'Answer!', { conversationId: sourceConv1.id });
      repo.create(sessionId, 'user', 'Another Q', { conversationId: sourceConv2.id });

      // Simulate creating new conversations (normally done via duplicateForSession)
      const targetConv1 = convRepo.create(sessionId, 'Target Conv 1');
      const targetConv2 = convRepo.create(sessionId, 'Target Conv 2');

      // Test the duplication
      const mapping = new Map([
        [sourceConv1.id, targetConv1.id],
        [sourceConv2.id, targetConv2.id]
      ]);
      repo.duplicateForConversations(mapping, sessionId);

      // Verify messages were copied
      const targetMsgs1 = repo.getByConversationId(targetConv1.id);
      const targetMsgs2 = repo.getByConversationId(targetConv2.id);

      expect(targetMsgs1).toHaveLength(2);
      expect(targetMsgs2).toHaveLength(1);
      expect(targetMsgs1[0].content).toBe('Question?');
      expect(targetMsgs1[1].content).toBe('Answer!');
      expect(targetMsgs2[0].content).toBe('Another Q');
    });

    it('should preserve message roles and toolUse', () => {
      const sourceConv = convRepo.create(sessionId, 'Test Conv');
      const toolUse = [{ name: 'bash', input: { command: 'ls -la' } }];

      repo.create(sessionId, 'user', 'Q', { conversationId: sourceConv.id });
      repo.create(sessionId, 'assistant', 'A', { toolUse, conversationId: sourceConv.id });

      const targetConv = convRepo.create(sessionId, 'Target Conv');

      const mapping = new Map([[sourceConv.id, targetConv.id]]);
      repo.duplicateForConversations(mapping, sessionId);

      const targetMsgs = repo.getByConversationId(targetConv.id);
      expect(targetMsgs).toHaveLength(2);
      expect(targetMsgs[0].role).toBe('user');
      expect(targetMsgs[0].content).toBe('Q');
      expect(targetMsgs[1].role).toBe('assistant');
      expect(targetMsgs[1].content).toBe('A');
      expect(targetMsgs[1].toolUse).toEqual(toolUse);
    });

    it('should preserve message order', () => {
      const sourceConv = convRepo.create(sessionId, 'Test Conv');

      repo.create(sessionId, 'user', 'First', { conversationId: sourceConv.id });
      repo.create(sessionId, 'assistant', 'Second', { conversationId: sourceConv.id });
      repo.create(sessionId, 'user', 'Third', { conversationId: sourceConv.id });

      const targetConv = convRepo.create(sessionId, 'Target Conv');

      const mapping = new Map([[sourceConv.id, targetConv.id]]);
      repo.duplicateForConversations(mapping, sessionId);

      const targetMsgs = repo.getByConversationId(targetConv.id);
      expect(targetMsgs.map(m => m.content)).toEqual(['First', 'Second', 'Third']);
    });

    it('should generate new message IDs', () => {
      const sourceConv = convRepo.create(sessionId, 'Test Conv');
      const originalMsg = repo.create(sessionId, 'user', 'Test', { conversationId: sourceConv.id });

      const targetConv = convRepo.create(sessionId, 'Target Conv');

      const mapping = new Map([[sourceConv.id, targetConv.id]]);
      repo.duplicateForConversations(mapping, sessionId);

      const targetMsgs = repo.getByConversationId(targetConv.id);
      expect(targetMsgs[0].id).not.toBe(originalMsg.id);
    });

    it('should handle empty conversation', () => {
      const sourceConv = convRepo.create(sessionId, 'Empty Conv');
      const targetConv = convRepo.create(sessionId, 'Target Conv');

      const mapping = new Map([[sourceConv.id, targetConv.id]]);
      repo.duplicateForConversations(mapping, sessionId);

      const targetMsgs = repo.getByConversationId(targetConv.id);
      expect(targetMsgs).toHaveLength(0);
    });
  });
});
