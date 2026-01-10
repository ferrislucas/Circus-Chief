import { describe, it, expect, beforeEach } from 'vitest';
import { TodoRepository } from './TodoRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('TodoRepository', () => {
  let repo;
  let conversationRepo;
  let projectRepo;
  let sessionId;
  let conversationId;

  beforeEach(() => {
    repo = new TodoRepository();
    conversationRepo = new ConversationRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;

    // Create a conversation for testing
    const conversation = conversationRepo.create(sessionId, 'Test Conversation');
    conversationId = conversation.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(TodoRepository);
      expect(repo.tableName).toBe('session_todos');
    });
  });

  describe('getByConversationId', () => {
    it('returns empty array when no todos exist', () => {
      const todos = repo.getByConversationId(conversationId);
      expect(todos).toEqual([]);
    });

    it('returns todos for a conversation ordered by position', () => {
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'First task', status: 'pending' },
        { content: 'Second task', status: 'in_progress' },
        { content: 'Third task', status: 'completed' },
      ]);

      const todos = repo.getByConversationId(conversationId);

      expect(todos).toHaveLength(3);
      expect(todos[0].content).toBe('First task');
      expect(todos[0].position).toBe(0);
      expect(todos[1].content).toBe('Second task');
      expect(todos[1].position).toBe(1);
      expect(todos[2].content).toBe('Third task');
      expect(todos[2].position).toBe(2);
    });

    it('only returns todos for the specified conversation', () => {
      // Create second conversation
      const conv2 = conversationRepo.create(sessionId, 'Second Conv');

      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Conv1 Task', status: 'pending' },
      ]);
      repo.replaceAllForConversation(sessionId, conv2.id, [
        { content: 'Conv2 Task', status: 'pending' },
      ]);

      const conv1Todos = repo.getByConversationId(conversationId);
      const conv2Todos = repo.getByConversationId(conv2.id);

      expect(conv1Todos).toHaveLength(1);
      expect(conv1Todos[0].content).toBe('Conv1 Task');
      expect(conv2Todos).toHaveLength(1);
      expect(conv2Todos[0].content).toBe('Conv2 Task');
    });
  });

  describe('replaceAllForConversation', () => {
    it('creates todos with conversation_id', () => {
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'completed' },
      ]);

      const todos = repo.getByConversationId(conversationId);

      expect(todos).toHaveLength(2);
      expect(todos[0].conversationId).toBe(conversationId);
      expect(todos[1].conversationId).toBe(conversationId);
    });

    it('replaces existing todos for the conversation', () => {
      // Add initial todos
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Old Task 1', status: 'pending' },
        { content: 'Old Task 2', status: 'pending' },
      ]);

      // Replace with new todos
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'New Task 1', status: 'in_progress' },
      ]);

      const todos = repo.getByConversationId(conversationId);

      expect(todos).toHaveLength(1);
      expect(todos[0].content).toBe('New Task 1');
      expect(todos[0].status).toBe('in_progress');
    });

    it('does not affect todos in other conversations', () => {
      const conv2 = conversationRepo.create(sessionId, 'Second Conv');

      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Conv1 Task', status: 'pending' },
      ]);
      repo.replaceAllForConversation(sessionId, conv2.id, [
        { content: 'Conv2 Task', status: 'pending' },
      ]);

      // Replace only conv1 todos
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Updated Conv1 Task', status: 'completed' },
      ]);

      const conv1Todos = repo.getByConversationId(conversationId);
      const conv2Todos = repo.getByConversationId(conv2.id);

      expect(conv1Todos).toHaveLength(1);
      expect(conv1Todos[0].content).toBe('Updated Conv1 Task');
      expect(conv2Todos).toHaveLength(1);
      expect(conv2Todos[0].content).toBe('Conv2 Task'); // Unchanged
    });

    it('returns the new todos', () => {
      const result = repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'in_progress' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Task 1');
      expect(result[1].content).toBe('Task 2');
    });

    it('handles empty todo list', () => {
      // Add initial todos
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Task', status: 'pending' },
      ]);

      // Replace with empty list
      const result = repo.replaceAllForConversation(sessionId, conversationId, []);

      expect(result).toHaveLength(0);
      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
    });
  });

  describe('deleteByConversationId', () => {
    it('deletes all todos for a conversation', () => {
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'completed' },
      ]);

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
    });

    it('does not affect todos in other conversations', () => {
      const conv2 = conversationRepo.create(sessionId, 'Second Conv');

      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Conv1 Task', status: 'pending' },
      ]);
      repo.replaceAllForConversation(sessionId, conv2.id, [
        { content: 'Conv2 Task', status: 'pending' },
      ]);

      repo.deleteByConversationId(conversationId);

      expect(repo.getByConversationId(conversationId)).toHaveLength(0);
      expect(repo.getByConversationId(conv2.id)).toHaveLength(1);
    });

    it('handles deleting from conversation with no todos', () => {
      // Should not throw
      expect(() => repo.deleteByConversationId(conversationId)).not.toThrow();
    });
  });

  describe('cascade delete behavior', () => {
    it('deletes todos when conversation is deleted', () => {
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'completed' },
      ]);

      // Delete the conversation
      conversationRepo.deleteAndHandleActive(conversationId);

      // Todos should be gone (CASCADE DELETE)
      const orphanedTodos = repo.getByConversationId(conversationId);
      expect(orphanedTodos).toHaveLength(0);
    });
  });

  describe('getBySessionId (legacy)', () => {
    it('returns all todos for a session', () => {
      const conv2 = conversationRepo.create(sessionId, 'Second Conv');

      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Conv1 Task', status: 'pending' },
      ]);
      repo.replaceAllForConversation(sessionId, conv2.id, [
        { content: 'Conv2 Task', status: 'pending' },
      ]);

      const todos = repo.getBySessionId(sessionId);

      expect(todos).toHaveLength(2);
    });
  });

  describe('todo properties', () => {
    it('includes all expected fields', () => {
      repo.replaceAllForConversation(sessionId, conversationId, [
        { content: 'Test Task', status: 'in_progress' },
      ]);

      const todos = repo.getByConversationId(conversationId);
      const todo = todos[0];

      expect(todo).toHaveProperty('id');
      expect(todo).toHaveProperty('sessionId');
      expect(todo).toHaveProperty('conversationId');
      expect(todo).toHaveProperty('content');
      expect(todo).toHaveProperty('status');
      expect(todo).toHaveProperty('position');
      expect(todo).toHaveProperty('updatedAt');

      expect(todo.sessionId).toBe(sessionId);
      expect(todo.conversationId).toBe(conversationId);
      expect(todo.content).toBe('Test Task');
      expect(todo.status).toBe('in_progress');
      expect(todo.position).toBe(0);
      expect(typeof todo.updatedAt).toBe('number');
    });
  });
});
