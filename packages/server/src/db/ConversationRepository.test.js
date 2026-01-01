import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationRepository } from './ConversationRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('ConversationRepository', () => {
  let repo;
  let messageRepo;
  let projectRepo;
  let sessionId;

  beforeEach(() => {
    repo = new ConversationRepository();
    messageRepo = new MessageRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(ConversationRepository);
      expect(repo.tableName).toBe('conversations');
    });
  });

  describe('create', () => {
    it('creates a conversation with name', () => {
      const conv = repo.create(sessionId, 'Test Conversation');

      expect(conv.id).toBeDefined();
      expect(conv.sessionId).toBe(sessionId);
      expect(conv.name).toBe('Test Conversation');
      expect(conv.isActive).toBe(true);
      expect(conv.createdAt).toBeTypeOf('number');
      expect(conv.updatedAt).toBeTypeOf('number');
    });

    it('creates a conversation without name', () => {
      const conv = repo.create(sessionId);

      expect(conv.name).toBeNull();
    });

    it('sets conversation as active by default', () => {
      const conv = repo.create(sessionId, 'Active Conv');

      expect(conv.isActive).toBe(true);
    });

    it('can create inactive conversation', () => {
      const conv = repo.create(sessionId, 'Inactive Conv', false);

      expect(conv.isActive).toBe(false);
    });

    it('deactivates other conversations when creating active one', () => {
      const conv1 = repo.create(sessionId, 'First');
      expect(conv1.isActive).toBe(true);

      const conv2 = repo.create(sessionId, 'Second');
      expect(conv2.isActive).toBe(true);

      // First should now be inactive
      const updated1 = repo.getById(conv1.id);
      expect(updated1.isActive).toBe(false);
    });

    it('generates unique IDs', () => {
      const conv1 = repo.create(sessionId, 'Conv 1');
      const conv2 = repo.create(sessionId, 'Conv 2');

      expect(conv1.id).not.toBe(conv2.id);
    });
  });

  describe('getById', () => {
    it('retrieves conversation by ID', () => {
      const created = repo.create(sessionId, 'Test conv');
      const retrieved = repo.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test conv');
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns empty array when no conversations exist', () => {
      const convs = repo.getBySessionId(sessionId);
      expect(convs).toEqual([]);
    });

    it('returns all conversations for a session', () => {
      repo.create(sessionId, 'Conv 1');
      repo.create(sessionId, 'Conv 2');
      repo.create(sessionId, 'Conv 3');

      const convs = repo.getBySessionId(sessionId);

      expect(convs).toHaveLength(3);
    });

    it('returns conversations ordered by createdAt ascending', () => {
      const c1 = repo.create(sessionId, 'First', false);
      const c2 = repo.create(sessionId, 'Second', false);
      const c3 = repo.create(sessionId, 'Third');

      const convs = repo.getBySessionId(sessionId);

      expect(convs[0].id).toBe(c1.id);
      expect(convs[1].id).toBe(c2.id);
      expect(convs[2].id).toBe(c3.id);
    });
  });

  describe('getActiveBySessionId', () => {
    it('returns null when no active conversation', () => {
      const result = repo.getActiveBySessionId(sessionId);
      expect(result).toBeNull();
    });

    it('returns the active conversation', () => {
      repo.create(sessionId, 'First');
      const active = repo.create(sessionId, 'Active One');

      const result = repo.getActiveBySessionId(sessionId);

      expect(result.id).toBe(active.id);
      expect(result.isActive).toBe(true);
    });
  });

  describe('getBySessionIdWithMessageCount', () => {
    it('includes message count for each conversation', () => {
      const conv = repo.create(sessionId, 'Test');

      // Add some messages
      messageRepo.create(sessionId, 'user', 'Hello', null, conv.id);
      messageRepo.create(sessionId, 'assistant', 'Hi there', null, conv.id);

      const convs = repo.getBySessionIdWithMessageCount(sessionId);

      expect(convs).toHaveLength(1);
      expect(convs[0].messageCount).toBe(2);
    });

    it('returns 0 for conversations with no messages', () => {
      repo.create(sessionId, 'Empty Conv');

      const convs = repo.getBySessionIdWithMessageCount(sessionId);

      expect(convs[0].messageCount).toBe(0);
    });
  });

  describe('update', () => {
    it('updates conversation name', () => {
      const conv = repo.create(sessionId, 'Original');
      const updated = repo.update(conv.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
    });

    it('updates summary', () => {
      const conv = repo.create(sessionId, 'Test');
      const updated = repo.update(conv.id, { summary: 'This is a summary' });

      expect(updated.summary).toBe('This is a summary');
    });

    it('updates summaryGeneratedAt', () => {
      const conv = repo.create(sessionId, 'Test');
      const now = Date.now();
      const updated = repo.update(conv.id, { summaryGeneratedAt: now });

      expect(updated.summaryGeneratedAt).toBe(now);
    });

    it('updates isActive and deactivates others', () => {
      const conv1 = repo.create(sessionId, 'First');
      const conv2 = repo.create(sessionId, 'Second', false);

      repo.update(conv2.id, { isActive: true });

      const updated1 = repo.getById(conv1.id);
      const updated2 = repo.getById(conv2.id);

      expect(updated1.isActive).toBe(false);
      expect(updated2.isActive).toBe(true);
    });

    it('returns same conversation if no updates provided', () => {
      const conv = repo.create(sessionId, 'Test');
      const updated = repo.update(conv.id, {});

      expect(updated.name).toBe('Test');
    });
  });

  describe('setActive', () => {
    it('sets conversation as active', () => {
      const conv1 = repo.create(sessionId, 'First');
      const conv2 = repo.create(sessionId, 'Second', false);

      const result = repo.setActive(conv2.id);

      expect(result.isActive).toBe(true);
      expect(repo.getById(conv1.id).isActive).toBe(false);
    });
  });

  describe('deleteAndHandleActive', () => {
    it('deletes conversation', () => {
      const conv = repo.create(sessionId, 'Delete me');
      repo.deleteAndHandleActive(conv.id);

      expect(repo.getById(conv.id)).toBeNull();
    });

    it('activates another conversation when deleting active one', () => {
      const conv1 = repo.create(sessionId, 'First', false);
      const conv2 = repo.create(sessionId, 'Second');

      const newActive = repo.deleteAndHandleActive(conv2.id);

      expect(newActive.id).toBe(conv1.id);
      expect(newActive.isActive).toBe(true);
    });

    it('creates new conversation when deleting last one', () => {
      const conv = repo.create(sessionId, 'Only One');
      const newActive = repo.deleteAndHandleActive(conv.id);

      expect(newActive).not.toBeNull();
      expect(newActive.name).toBe('New Conversation');
      expect(newActive.isActive).toBe(true);
    });

    it('returns null when deleting non-existent conversation', () => {
      const result = repo.deleteAndHandleActive('non-existent');
      expect(result).toBeNull();
    });

    it('returns null when deleting non-active conversation', () => {
      const conv1 = repo.create(sessionId, 'First', false);
      repo.create(sessionId, 'Second');

      const result = repo.deleteAndHandleActive(conv1.id);

      expect(result).toBeNull();
      expect(repo.getById(conv1.id)).toBeNull();
    });
  });

  describe('ensureActiveConversation', () => {
    it('creates initial conversation if none exist', () => {
      const active = repo.ensureActiveConversation(sessionId);

      expect(active).not.toBeNull();
      expect(active.name).toBe('Initial');
      expect(active.isActive).toBe(true);
    });

    it('returns existing active conversation', () => {
      const existing = repo.create(sessionId, 'Existing');
      const active = repo.ensureActiveConversation(sessionId);

      expect(active.id).toBe(existing.id);
    });

    it('activates first conversation if none is active', () => {
      // Create conversations but make them all inactive
      const conv = repo.create(sessionId, 'Conv', false);

      const active = repo.ensureActiveConversation(sessionId);

      expect(active.id).toBe(conv.id);
      expect(active.isActive).toBe(true);
    });
  });

  describe('autoName', () => {
    it('auto-names conversation from first message', () => {
      const conv = repo.create(sessionId);
      const updated = repo.autoName(conv.id, 'Help me build a React component');

      expect(updated.name).toBe('Help me build a React component');
    });

    it('truncates long messages', () => {
      const conv = repo.create(sessionId);
      const longMessage = 'This is a very long message that should be truncated at some point because it exceeds the maximum allowed characters';
      const updated = repo.autoName(conv.id, longMessage);

      expect(updated.name.length).toBeLessThanOrEqual(55); // 50 chars + "..."
    });

    it('adds ellipsis for truncated messages', () => {
      const conv = repo.create(sessionId);
      const message = 'Hello world this is a test message that should truncate nicely at a word boundary';
      const updated = repo.autoName(conv.id, message);

      expect(updated.name.endsWith('...')).toBe(true);
      expect(updated.name.length).toBeLessThanOrEqual(55);
    });
  });

  describe('updateUsage', () => {
    it('updates token usage fields on conversation', () => {
      const conv = repo.create(sessionId, 'Test Conv');

      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 2,
        contextWindow: 200000,
        model: 'claude-sonnet-4-20250514',
      };

      const updated = repo.updateUsage(conv.id, usage);

      expect(updated.inputTokens).toBe(1000);
      expect(updated.outputTokens).toBe(500);
      expect(updated.cacheReadInputTokens).toBe(200);
      expect(updated.cacheCreationInputTokens).toBe(100);
      expect(updated.webSearchRequests).toBe(2);
      expect(updated.contextWindow).toBe(200000);
      expect(updated.model).toBe('claude-sonnet-4-20250514');
    });

    it('handles partial usage updates', () => {
      const conv = repo.create(sessionId, 'Test Conv');

      // Only update some fields
      const usage = {
        inputTokens: 500,
        outputTokens: 250,
      };

      const updated = repo.updateUsage(conv.id, usage);

      expect(updated.inputTokens).toBe(500);
      expect(updated.outputTokens).toBe(250);
      // Other fields should remain at defaults
      expect(updated.cacheReadInputTokens).toBe(0);
      expect(updated.cacheCreationInputTokens).toBe(0);
      expect(updated.webSearchRequests).toBe(0);
    });

    it('returns null for non-existent conversation', () => {
      const result = repo.updateUsage('non-existent-id', { inputTokens: 100 });
      expect(result).toBeNull();
    });

    it('updates updatedAt timestamp', () => {
      const conv = repo.create(sessionId, 'Test Conv');
      const originalUpdatedAt = conv.updatedAt;

      // Small delay to ensure different timestamp
      const updated = repo.updateUsage(conv.id, { inputTokens: 100 });

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('preserves other conversation fields', () => {
      const conv = repo.create(sessionId, 'My Conversation');
      repo.update(conv.id, { summary: 'Test summary' });

      const updated = repo.updateUsage(conv.id, { inputTokens: 100 });

      expect(updated.name).toBe('My Conversation');
      expect(updated.summary).toBe('Test summary');
      expect(updated.sessionId).toBe(sessionId);
    });

    it('can accumulate usage across multiple updates', () => {
      const conv = repo.create(sessionId, 'Test Conv');

      // First update
      repo.updateUsage(conv.id, { inputTokens: 100, outputTokens: 50 });

      // Second update (simulating accumulated totals)
      const updated = repo.updateUsage(conv.id, { inputTokens: 300, outputTokens: 150 });

      expect(updated.inputTokens).toBe(300);
      expect(updated.outputTokens).toBe(150);
    });
  });

  describe('duplicateForSession', () => {
    it('should copy all conversations to new session', () => {
      const project = projectRepo.create('Test Project 2', '/tmp/test2');
      const now = Date.now();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      const _conv1 = repo.create(sessionId, 'Initial');
      const _conv2 = repo.create(sessionId, 'Follow-up');

      const mapping = repo.duplicateForSession(sessionId, targetSessionId);

      expect(mapping.size).toBe(2);
      const targetConvs = repo.getBySessionId(targetSessionId);
      expect(targetConvs).toHaveLength(2);
      expect(targetConvs.map(c => c.name)).toContain('Initial');
      expect(targetConvs.map(c => c.name)).toContain('Follow-up');
    });

    it('should return correct ID mapping', () => {
      const project = projectRepo.create('Test Project 3', '/tmp/test3');
      const now = Date.now();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      const conv = repo.create(sessionId, 'Test');

      const mapping = repo.duplicateForSession(sessionId, targetSessionId);

      expect(mapping.has(conv.id)).toBe(true);
      const newId = mapping.get(conv.id);
      expect(newId).not.toBe(conv.id);
      expect(repo.getById(newId)).toBeDefined();
    });

    it('should preserve isActive flag', () => {
      const project = projectRepo.create('Test Project 4', '/tmp/test4');
      const now = Date.now();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      repo.create(sessionId, 'Inactive', false);
      repo.create(sessionId, 'Active', true);

      repo.duplicateForSession(sessionId, targetSessionId);

      const targetConvs = repo.getBySessionId(targetSessionId);
      const active = targetConvs.find(c => c.name === 'Active');
      const inactive = targetConvs.find(c => c.name === 'Inactive');
      expect(active.isActive).toBe(true);
      expect(inactive.isActive).toBe(false);
    });

    it('should preserve conversation summaries', () => {
      const project = projectRepo.create('Test Project 5', '/tmp/test5');
      const now = Date.now();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      const conv = repo.create(sessionId, 'Test');
      repo.update(conv.id, { summary: 'This is a summary' });

      const mapping = repo.duplicateForSession(sessionId, targetSessionId);

      const newConv = repo.getById(mapping.get(conv.id));
      expect(newConv.summary).toBe('This is a summary');
    });

    it('should handle session with no conversations', () => {
      const project = projectRepo.create('Test Project 6', '/tmp/test6');
      const now = Date.now();
      const emptySessionId = databaseManager.generateId();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(emptySessionId, project.id, 'Empty Session', 'waiting', 'standard', now, now);
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      const mapping = repo.duplicateForSession(emptySessionId, targetSessionId);

      expect(mapping.size).toBe(0);
      expect(repo.getBySessionId(targetSessionId)).toHaveLength(0);
    });

    it('should generate new IDs for all conversations', () => {
      const project = projectRepo.create('Test Project 7', '/tmp/test7');
      const now = Date.now();
      const targetSessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target Session', 'waiting', 'standard', now, now);

      const conv1 = repo.create(sessionId);
      const conv2 = repo.create(sessionId);

      const mapping = repo.duplicateForSession(sessionId, targetSessionId);

      const newIds = Array.from(mapping.values());
      expect(newIds).not.toContain(conv1.id);
      expect(newIds).not.toContain(conv2.id);
    });
  });
});
