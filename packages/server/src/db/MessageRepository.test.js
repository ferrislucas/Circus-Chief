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
      const message = repo.create(sessionId, 'assistant', 'Running command...', toolUse);

      expect(message.toolUse).toEqual(toolUse);
    });

    it('handles complex toolUse objects', () => {
      const toolUse = [
        { name: 'read', input: { path: '/tmp/file.txt' } },
        { name: 'write', input: { path: '/tmp/out.txt', content: 'data' } },
      ];
      const message = repo.create(sessionId, 'assistant', 'Processing...', toolUse);

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
      const message = repo.create(sessionId, 'user', 'Hello!', null, conversationId);

      expect(message.conversationId).toBe(conversationId);
      expect(message.sessionId).toBe(sessionId);
    });

    it('creates a message with null conversationId by default', () => {
      const message = repo.create(sessionId, 'user', 'Hello!');

      expect(message.conversationId).toBeNull();
    });

    it('creates a message with both toolUse and conversationId', () => {
      const toolUse = [{ name: 'read', input: { path: '/tmp/file.txt' } }];
      const message = repo.create(sessionId, 'assistant', 'Reading...', toolUse, conversationId);

      expect(message.toolUse).toEqual(toolUse);
      expect(message.conversationId).toBe(conversationId);
    });
  });

  describe('getByConversationId', () => {
    it('returns empty array when no messages exist', () => {
      const messages = repo.getByConversationId(conversationId);
      expect(messages).toEqual([]);
    });

    it('returns all messages for a conversation', () => {
      repo.create(sessionId, 'user', 'Message 1', null, conversationId);
      repo.create(sessionId, 'assistant', 'Message 2', null, conversationId);
      repo.create(sessionId, 'user', 'Message 3', null, conversationId);

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(3);
    });

    it('returns messages in chronological order (ASC)', () => {
      repo.create(sessionId, 'user', 'First', null, conversationId);
      repo.create(sessionId, 'assistant', 'Second', null, conversationId);
      repo.create(sessionId, 'user', 'Third', null, conversationId);

      const messages = repo.getByConversationId(conversationId);

      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('does not return messages from other conversations', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1 message', null, conversationId);
      repo.create(sessionId, 'user', 'Conv 2 message', null, otherConv.id);

      const messages = repo.getByConversationId(conversationId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Conv 1 message');
    });

    it('does not return messages without conversationId', () => {
      repo.create(sessionId, 'user', 'With conv', null, conversationId);
      repo.create(sessionId, 'user', 'Without conv', null, null);

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
      repo.create(sessionId, 'user', 'Message 1', null, conversationId);
      repo.create(sessionId, 'assistant', 'Message 2', null, conversationId);
      repo.create(sessionId, 'user', 'Message 3', null, conversationId);

      const count = repo.getCountByConversationId(conversationId);

      expect(count).toBe(3);
    });

    it('only counts messages for specified conversation', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1', null, conversationId);
      repo.create(sessionId, 'user', 'Conv 1 again', null, conversationId);
      repo.create(sessionId, 'user', 'Conv 2', null, otherConv.id);

      expect(repo.getCountByConversationId(conversationId)).toBe(2);
      expect(repo.getCountByConversationId(otherConv.id)).toBe(1);
    });
  });

  describe('deleteByConversationId', () => {
    it('deletes all messages for a conversation', () => {
      repo.create(sessionId, 'user', 'Message 1', null, conversationId);
      repo.create(sessionId, 'assistant', 'Message 2', null, conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(2);

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
    });

    it('does not delete messages from other conversations', () => {
      const otherConv = convRepo.create(sessionId, 'Other Conversation', false);

      repo.create(sessionId, 'user', 'Conv 1 message', null, conversationId);
      repo.create(sessionId, 'user', 'Conv 2 message', null, otherConv.id);

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
      expect(repo.getByConversationId(otherConv.id)).toHaveLength(1);
    });

    it('does not throw when no messages exist', () => {
      expect(() => repo.deleteByConversationId(conversationId)).not.toThrow();
    });

    it('does not affect messages without conversationId', () => {
      repo.create(sessionId, 'user', 'With conv', null, conversationId);
      repo.create(sessionId, 'user', 'Without conv', null, null);

      repo.deleteByConversationId(conversationId);

      const allMessages = repo.getBySessionId(sessionId);
      expect(allMessages).toHaveLength(1);
      expect(allMessages[0].content).toBe('Without conv');
    });
  });
});
