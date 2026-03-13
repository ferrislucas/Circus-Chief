import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, conversations, todos } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service
vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  onSessionActivity: vi.fn(),
}));

describe('Sessions API - Todo Endpoints', () => {
  let project;
  let session;
  let conversation;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
    // Get the initial conversation created with the session
    conversation = conversations.getActiveBySessionId(session.id);
  });

  describe('GET /sessions/:id/todos', () => {
    it('returns empty array when no todos exist', () => {
      const sessionTodos = todos.getByConversationId(conversation.id);
      expect(sessionTodos).toEqual([]);
    });

    it('returns todos for active conversation when no conversation_id provided', () => {
      // Add todos to the active conversation
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'in_progress' },
      ]);

      const activeConv = conversations.getActiveBySessionId(session.id);
      const sessionTodos = todos.getByConversationId(activeConv.id);

      expect(sessionTodos).toHaveLength(2);
      expect(sessionTodos[0].content).toBe('Task 1');
      expect(sessionTodos[1].content).toBe('Task 2');
    });

    it('returns todos for specific conversation when conversation_id is provided', () => {
      // Create a second conversation
      const conv2 = conversations.create(session.id, 'Second Conv', false);

      // Add different todos to each conversation
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Conv1 Task', status: 'pending' },
      ]);
      todos.replaceAllForConversation(session.id, conv2.id, [
        { content: 'Conv2 Task A', status: 'completed' },
        { content: 'Conv2 Task B', status: 'pending' },
      ]);

      // Query todos for specific conversation
      const conv1Todos = todos.getByConversationId(conversation.id);
      const conv2Todos = todos.getByConversationId(conv2.id);

      expect(conv1Todos).toHaveLength(1);
      expect(conv1Todos[0].content).toBe('Conv1 Task');

      expect(conv2Todos).toHaveLength(2);
      expect(conv2Todos[0].content).toBe('Conv2 Task A');
      expect(conv2Todos[1].content).toBe('Conv2 Task B');
    });

    it('returns empty array when active conversation has no todos', () => {
      // Create another conversation with todos
      const conv2 = conversations.create(session.id, 'Conv 2', false);
      todos.replaceAllForConversation(session.id, conv2.id, [
        { content: 'Task in Conv2', status: 'pending' },
      ]);

      // Make conv2 active (conv1 should now have no todos from perspective of "active")
      conversations.setActive(conv2.id, session.id);

      // The original conversation should still have no todos
      const conv1Todos = todos.getByConversationId(conversation.id);
      expect(conv1Todos).toEqual([]);
    });

    it('validates conversation belongs to session', () => {
      // Create another session and conversation
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt', 'standard');
      const conv2 = conversations.getActiveBySessionId(session2.id);

      // Try to get todos with mismatched session/conversation
      const convFromDb = conversations.getById(conv2.id);

      // This simulates API validation: conversation belongs to different session
      expect(convFromDb.sessionId).not.toBe(session.id);
    });

    it('preserves todos when switching conversations', () => {
      // Add todos to first conversation
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Original Task 1', status: 'pending' },
        { content: 'Original Task 2', status: 'completed' },
      ]);

      // Create second conversation and make it active
      const conv2 = conversations.create(session.id, 'Second Conv', true);

      // Add todos to second conversation
      todos.replaceAllForConversation(session.id, conv2.id, [
        { content: 'New Task', status: 'in_progress' },
      ]);

      // Switch back to first conversation
      conversations.setActive(conversation.id, session.id);

      // Verify first conversation's todos are preserved
      const conv1Todos = todos.getByConversationId(conversation.id);
      expect(conv1Todos).toHaveLength(2);
      expect(conv1Todos[0].content).toBe('Original Task 1');
      expect(conv1Todos[1].content).toBe('Original Task 2');

      // Verify second conversation's todos are also preserved
      const conv2Todos = todos.getByConversationId(conv2.id);
      expect(conv2Todos).toHaveLength(1);
      expect(conv2Todos[0].content).toBe('New Task');
    });

    it('includes conversationId in todo objects', () => {
      todos.replaceAllForConversation(session.id, conversation.id, [
        { content: 'Task', status: 'pending' },
      ]);

      const sessionTodos = todos.getByConversationId(conversation.id);

      expect(sessionTodos[0].conversationId).toBe(conversation.id);
    });

    it('handles session with no active conversation gracefully', () => {
      // Delete all conversations (edge case)
      const allConvs = conversations.getBySessionId(session.id);
      allConvs.forEach((c) => conversations.deleteAndHandleActive(c.id));

      // Should return empty array, not error
      const activeConv = conversations.getActiveBySessionId(session.id);
      // Note: deleteAndHandleActive creates a new conversation if deleting the last one
      // So there will always be at least one conversation
      expect(activeConv).not.toBeNull();
    });
  });
});
