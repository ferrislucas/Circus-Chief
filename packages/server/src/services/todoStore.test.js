import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, conversations, todos } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Import after mocks are set up
import { updateTodos, getTodosByConversation, getTodosForSession, clearTodos } from './todoStore.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

describe('todoStore - conversation-scoped functions', () => {
  let project;
  let session;
  let conversation;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
    conversation = conversations.getActiveBySessionId(session.id);
  });

  describe('updateTodos', () => {
    it('replaces all todos for a conversation', () => {
      const todoList = [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'in_progress' },
        { content: 'Task 3', status: 'completed' },
      ];

      const result = updateTodos(session.id, conversation.id, todoList);

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('Task 1');
      expect(result[0].status).toBe('pending');
      expect(result[1].content).toBe('Task 2');
      expect(result[1].status).toBe('in_progress');
      expect(result[2].content).toBe('Task 3');
      expect(result[2].status).toBe('completed');
    });

    it('broadcasts TODOS_UPDATE with conversationId', () => {
      const todoList = [{ content: 'Task', status: 'pending' }];

      updateTodos(session.id, conversation.id, todoList);

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.TODOS_UPDATE,
        expect.objectContaining({
          sessionId: session.id,
          conversationId: conversation.id,
          todos: expect.any(Array),
        })
      );
    });

    it('replaces existing todos when called again', () => {
      // First update
      updateTodos(session.id, conversation.id, [
        { content: 'Original Task', status: 'pending' },
      ]);

      // Second update should replace
      const result = updateTodos(session.id, conversation.id, [
        { content: 'New Task 1', status: 'completed' },
        { content: 'New Task 2', status: 'pending' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('New Task 1');
      expect(result[1].content).toBe('New Task 2');

      // Verify original task is gone
      const allTodos = todos.getByConversationId(conversation.id);
      expect(allTodos.find((t) => t.content === 'Original Task')).toBeUndefined();
    });

    it('does not affect todos in other conversations', () => {
      const conv2 = conversations.create(session.id, 'Second Conv', false);

      // Add todos to conv1
      updateTodos(session.id, conversation.id, [{ content: 'Conv1 Task', status: 'pending' }]);

      // Add todos to conv2
      updateTodos(session.id, conv2.id, [{ content: 'Conv2 Task', status: 'in_progress' }]);

      // Update conv1 todos
      updateTodos(session.id, conversation.id, [{ content: 'New Conv1 Task', status: 'completed' }]);

      // Conv2 todos should be unchanged
      const conv2Todos = todos.getByConversationId(conv2.id);
      expect(conv2Todos).toHaveLength(1);
      expect(conv2Todos[0].content).toBe('Conv2 Task');
    });

    it('handles empty todo list', () => {
      // First add some todos
      updateTodos(session.id, conversation.id, [{ content: 'Task', status: 'pending' }]);

      // Then clear with empty array
      const result = updateTodos(session.id, conversation.id, []);

      expect(result).toHaveLength(0);
      expect(todos.getByConversationId(conversation.id)).toHaveLength(0);
    });

    it('returns todos with conversationId field', () => {
      const result = updateTodos(session.id, conversation.id, [{ content: 'Task', status: 'pending' }]);

      expect(result[0].conversationId).toBe(conversation.id);
    });
  });

  describe('getTodosByConversation', () => {
    it('returns todos for a specific conversation', () => {
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'completed' },
      ]);

      const result = getTodosByConversation(conversation.id);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Task 1');
      expect(result[1].content).toBe('Task 2');
    });

    it('returns empty array for conversation with no todos', () => {
      const result = getTodosByConversation(conversation.id);
      expect(result).toEqual([]);
    });

    it('returns only todos for specified conversation', () => {
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      todos.replaceAllForConversation(session.id, conversation.id, [{ content: 'Conv1 Task', status: 'pending' }]);
      todos.replaceAllForConversation(session.id, conv2.id, [{ content: 'Conv2 Task', status: 'pending' }]);

      const conv1Todos = getTodosByConversation(conversation.id);
      const conv2Todos = getTodosByConversation(conv2.id);

      expect(conv1Todos).toHaveLength(1);
      expect(conv1Todos[0].content).toBe('Conv1 Task');

      expect(conv2Todos).toHaveLength(1);
      expect(conv2Todos[0].content).toBe('Conv2 Task');
    });
  });

  describe('getTodosForSession', () => {
    it('returns todos for active conversation', () => {
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Active Conv Task', status: 'pending' },
      ]);

      const result = getTodosForSession(session.id);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Active Conv Task');
    });

    it('returns empty array when active conversation has no todos', () => {
      const result = getTodosForSession(session.id);
      expect(result).toEqual([]);
    });

    it('returns todos from currently active conversation only', () => {
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      // Add todos to both conversations
      todos.replaceAllForConversation(session.id, conversation.id, [{ content: 'Conv1 Task', status: 'pending' }]);
      todos.replaceAllForConversation(session.id, conv2.id, [{ content: 'Conv2 Task', status: 'pending' }]);

      // Initially, first conversation is active
      let result = getTodosForSession(session.id);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Conv1 Task');

      // Switch active conversation
      conversations.setActive(conv2.id, session.id);

      result = getTodosForSession(session.id);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Conv2 Task');
    });
  });

  describe('clearTodos', () => {
    it('clears all todos for a conversation', () => {
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'completed' },
      ]);

      clearTodos(session.id, conversation.id);

      expect(todos.getByConversationId(conversation.id)).toHaveLength(0);
    });

    it('broadcasts TODOS_UPDATE with empty array and conversationId', () => {
      clearTodos(session.id, conversation.id);

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.TODOS_UPDATE,
        {
          sessionId: session.id,
          conversationId: conversation.id,
          todos: [],
        }
      );
    });

    it('does not affect todos in other conversations', () => {
      const conv2 = conversations.create(session.id, 'Conv 2', false);

      todos.replaceAllForConversation(session.id, conversation.id, [{ content: 'Conv1 Task', status: 'pending' }]);
      todos.replaceAllForConversation(session.id, conv2.id, [{ content: 'Conv2 Task', status: 'pending' }]);

      // Clear only conv1 todos
      clearTodos(session.id, conversation.id);

      // Conv2 should still have its todos
      expect(todos.getByConversationId(conv2.id)).toHaveLength(1);
      expect(todos.getByConversationId(conv2.id)[0].content).toBe('Conv2 Task');
    });
  });
});
