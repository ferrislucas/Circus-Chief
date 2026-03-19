import { describe, it, expect, beforeEach } from 'vitest';
import { WorkLogRepository } from './WorkLogRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('WorkLogRepository', () => {
  let repo;
  let projectRepo;
  let messageRepo;
  let convRepo;
  let sessionId;
  let messageId;

  beforeEach(() => {
    repo = new WorkLogRepository();
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();
    convRepo = new ConversationRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;

    // Create a conversation and message for testing
    const conversation = convRepo.create(sessionId, 'Test Conversation', true);
    const message = messageRepo.create(sessionId, 'assistant', 'Test response', null, conversation.id);
    messageId = message.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(WorkLogRepository);
      expect(repo.tableName).toBe('work_logs');
    });
  });

  describe('create', () => {
    it('creates a work log with all options', () => {
      const log = repo.create(sessionId, 'thinking', 'Some thoughts', { messageId, toolName: 'bash' });

      expect(log.id).toBeDefined();
      expect(log.sessionId).toBe(sessionId);
      expect(log.type).toBe('thinking');
      expect(log.content).toBe('Some thoughts');
      expect(log.messageId).toBe(messageId);
      expect(log.toolName).toBe('bash');
      expect(log.timestamp).toBeTypeOf('number');
    });

    it('creates a work log with explicit null messageId and toolName', () => {
      const log = repo.create(sessionId, 'tool_input', 'ls -la', { messageId: null, toolName: null });

      expect(log.messageId).toBeNull();
      expect(log.toolName).toBeNull();
    });

    it('creates a work log with only required parameters', () => {
      const log = repo.create(sessionId, 'tool_output', 'Output data');

      expect(log.sessionId).toBe(sessionId);
      expect(log.type).toBe('tool_output');
      expect(log.content).toBe('Output data');
      expect(log.messageId).toBeNull();
      expect(log.toolName).toBeNull();
    });

    it('creates a work log with messageId but no toolName', () => {
      const log = repo.create(sessionId, 'thinking', 'Some thoughts', { messageId });

      expect(log.messageId).toBe(messageId);
      expect(log.toolName).toBeNull();
    });
  });

  describe('create with options object signature', () => {
    it('creates a work log with options object containing messageId and toolName', () => {
      const log = repo.create(sessionId, 'thinking', 'Content', { messageId, toolName: 'bash' });

      expect(log.sessionId).toBe(sessionId);
      expect(log.type).toBe('thinking');
      expect(log.content).toBe('Content');
      expect(log.messageId).toBe(messageId);
      expect(log.toolName).toBe('bash');
    });

    it('creates a work log with options object containing only messageId', () => {
      const log = repo.create(sessionId, 'tool_input', 'Input', { messageId });

      expect(log.messageId).toBe(messageId);
      expect(log.toolName).toBeNull();
    });

    it('creates a work log with options object containing only toolName', () => {
      const log = repo.create(sessionId, 'tool_output', 'Output', { toolName: 'read' });

      expect(log.messageId).toBeNull();
      expect(log.toolName).toBe('read');
    });

    it('creates a work log with empty options object (all defaults)', () => {
      const log = repo.create(sessionId, 'thinking', 'Thoughts', {});

      expect(log.messageId).toBeNull();
      expect(log.toolName).toBeNull();
    });

    it('creates a work log with null values in options object', () => {
      const log = repo.create(sessionId, 'thinking', 'Content', { messageId: null, toolName: null });

      expect(log.messageId).toBeNull();
      expect(log.toolName).toBeNull();
    });
  });

  describe('create with null options', () => {
    it('handles null options gracefully (uses defaults)', () => {
      const log = repo.create(sessionId, 'thinking', 'Content', null);

      expect(log.messageId).toBeNull();
      expect(log.toolName).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns empty array when no logs exist', () => {
      const logs = repo.getBySessionId(sessionId);
      expect(logs).toEqual([]);
    });

    it('returns all logs for a session in chronological order', () => {
      repo.create(sessionId, 'thinking', 'Thought 1');
      repo.create(sessionId, 'tool_input', 'Input 1');
      repo.create(sessionId, 'tool_output', 'Output 1');

      const logs = repo.getBySessionId(sessionId);

      expect(logs).toHaveLength(3);
      expect(logs[0].type).toBe('thinking');
      expect(logs[1].type).toBe('tool_input');
      expect(logs[2].type).toBe('tool_output');
    });
  });

  describe('getByMessageId', () => {
    it('returns logs for a specific message', () => {
      repo.create(sessionId, 'thinking', 'Thought 1', { messageId });
      repo.create(sessionId, 'tool_input', 'Input 1', { messageId });

      const logs = repo.getByMessageId(messageId);

      expect(logs).toHaveLength(2);
    });

    it('returns empty array when no logs exist for message', () => {
      const logs = repo.getByMessageId('non-existent');
      expect(logs).toEqual([]);
    });
  });

  describe('associatePendingLogs', () => {
    it('associates unassigned logs with a message', () => {
      repo.create(sessionId, 'thinking', 'Pending thought 1');
      repo.create(sessionId, 'thinking', 'Pending thought 2');

      const count = repo.associatePendingLogs(sessionId, messageId);

      expect(count).toBe(2);

      const logs = repo.getByMessageId(messageId);
      expect(logs).toHaveLength(2);
    });

    it('does not affect logs already associated with a message', () => {
      repo.create(sessionId, 'thinking', 'Already assigned', { messageId });
      repo.create(sessionId, 'thinking', 'Pending');

      const otherMessage = messageRepo.create(sessionId, 'assistant', 'Other response');
      const count = repo.associatePendingLogs(sessionId, otherMessage.id);

      expect(count).toBe(1);

      // Original message's log should still be there
      const originalLogs = repo.getByMessageId(messageId);
      expect(originalLogs).toHaveLength(1);
    });
  });

  describe('getRecentPendingBySessionId', () => {
    it('returns only work logs with message_id IS NULL', () => {
      repo.create(sessionId, 'thinking', 'Pending 1');
      repo.create(sessionId, 'thinking', 'Pending 2');
      repo.create(sessionId, 'thinking', 'Associated', { messageId });

      const pending = repo.getRecentPendingBySessionId(sessionId);
      expect(pending).toHaveLength(2);
      expect(pending.every(l => l.messageId === null)).toBe(true);
    });

    it('does not return work logs that have a message_id set', () => {
      repo.create(sessionId, 'thinking', 'Associated 1', { messageId });
      repo.create(sessionId, 'thinking', 'Associated 2', { messageId });

      const pending = repo.getRecentPendingBySessionId(sessionId);
      expect(pending).toEqual([]);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        repo.create(sessionId, 'thinking', `Pending ${i}`);
      }

      const pending = repo.getRecentPendingBySessionId(sessionId);
      expect(pending).toHaveLength(15); // default limit
    });

    it('returns results ordered by timestamp DESC (newest first)', () => {
      // Insert logs with explicit different timestamps to ensure ordering
      const db = databaseManager.get();
      const baseTime = Date.now();
      const ids = [databaseManager.generateId(), databaseManager.generateId(), databaseManager.generateId()];

      db.prepare('INSERT INTO work_logs (id, session_id, message_id, type, tool_name, content, timestamp) VALUES (?, ?, NULL, ?, NULL, ?, ?)').run(ids[0], sessionId, 'thinking', 'First', baseTime);
      db.prepare('INSERT INTO work_logs (id, session_id, message_id, type, tool_name, content, timestamp) VALUES (?, ?, NULL, ?, NULL, ?, ?)').run(ids[1], sessionId, 'thinking', 'Second', baseTime + 1000);
      db.prepare('INSERT INTO work_logs (id, session_id, message_id, type, tool_name, content, timestamp) VALUES (?, ?, NULL, ?, NULL, ?, ?)').run(ids[2], sessionId, 'thinking', 'Third', baseTime + 2000);

      const pending = repo.getRecentPendingBySessionId(sessionId);
      // Newest first
      expect(pending[0].content).toBe('Third');
      expect(pending[1].content).toBe('Second');
      expect(pending[2].content).toBe('First');
    });

    it('returns empty array when all logs are associated with messages', () => {
      repo.create(sessionId, 'thinking', 'Log 1', { messageId });
      repo.create(sessionId, 'thinking', 'Log 2', { messageId });

      const pending = repo.getRecentPendingBySessionId(sessionId);
      expect(pending).toEqual([]);
    });

    it('allows custom limit', () => {
      for (let i = 0; i < 10; i++) {
        repo.create(sessionId, 'thinking', `Pending ${i}`);
      }

      const pending = repo.getRecentPendingBySessionId(sessionId, 3);
      expect(pending).toHaveLength(3);
    });
  });

  describe('deleteBySessionId', () => {
    it('deletes all logs for a session', () => {
      repo.create(sessionId, 'thinking', 'Log 1');
      repo.create(sessionId, 'thinking', 'Log 2');

      repo.deleteBySessionId(sessionId);

      const logs = repo.getBySessionId(sessionId);
      expect(logs).toHaveLength(0);
    });
  });
});
