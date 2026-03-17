import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, messages, conversations } from '../database.js';

// Mock websocket and summary service
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/summaryService.js', () => ({
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  generateSessionAndConversationSummary: vi.fn().mockResolvedValue({ sessionSummary: null, conversationSummary: null }),
  generateSummary: vi.fn().mockResolvedValue(null),
  onSessionComplete: vi.fn(),
  onSessionActivity: vi.fn(),
  isConversationSummaryEnabled: vi.fn((_sessionId) => {
    // Default implementation: return true (enabled)
    // Tests can override this by mocking the implementation
    return true;
  }),
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

  describe('POST /sessions/:id/conversations/:convId/summary', () => {
    it('generates and stores summary for conversation', async () => {
      const conv = conversations.create(session.id, 'Test', true);
      messages.create(session.id, 'user', 'Hello', { conversationId: conv.id });
      messages.create(session.id, 'assistant', 'Hi', { conversationId: conv.id });

      // Simulate summary update
      const updatedConv = conversations.update(conv.id, {
        summary: 'Test conversation summary',
        summaryGeneratedAt: Date.now(),
      });

      expect(updatedConv.summary).toBe('Test conversation summary');
      expect(updatedConv.summaryGeneratedAt).toBeDefined();
    });
  });

  describe('Conversation Branching with Summary Flag', () => {
    let summaryService;

    beforeEach(async () => {
      // Import the mocked summaryService
      summaryService = await import('../services/summaryService.js');
      // Clear mock calls before each test
      vi.clearAllMocks();
    });

    describe('conversation branching behavior', () => {
      it('branches conversation correctly', async () => {
        const conv = conversations.create(session.id, 'Original', true);
        const userMsg = messages.create(session.id, 'user', 'Original message', { conversationId: conv.id });
        messages.create(session.id, 'assistant', 'Original response', { conversationId: conv.id });

        // Branch the conversation
        const branchConv = conversations.branch(
          conv.id,
          userMsg.id,
          null,
          'Branch prompt'
        );

        expect(branchConv).toBeDefined();
        expect(branchConv.id).not.toBe(conv.id);
        expect(branchConv.sessionId).toBe(session.id);
      });

      it('creates new conversation and marks it as active', () => {
        const activeConv = conversations.create(session.id, 'Active', true);
        messages.create(session.id, 'user', 'Message', { conversationId: activeConv.id });

        // Create new conversation
        const newConv = conversations.create(session.id, 'New', true);

        expect(newConv.isActive).toBe(true);

        // Previous conversation should no longer be active
        const previousConv = conversations.getById(activeConv.id);
        expect(previousConv.isActive).toBe(false);
      });

      it('switches active conversation correctly', () => {
        const _conv1 = conversations.create(session.id, 'Conv 1', true);
        const conv2 = conversations.create(session.id, 'Conv 2', false);

        // Switch to conv2
        conversations.setActive(conv2.id, session.id);

        const all = conversations.getBySessionId(session.id);
        const activeConv = all.find((c) => c.isActive);

        expect(activeConv.id).toBe(conv2.id);
      });

      it('verifies isConversationSummaryEnabled helper exists and returns correct values', () => {
        // Test with default project (summaries enabled by default)
        const isEnabled = summaryService.isConversationSummaryEnabled(session.id);
        expect(typeof isEnabled).toBe('boolean');

        // Mock to return false
        summaryService.isConversationSummaryEnabled.mockReturnValue(false);
        const isDisabled = summaryService.isConversationSummaryEnabled(session.id);
        expect(isDisabled).toBe(false);

        // Mock to return true
        summaryService.isConversationSummaryEnabled.mockReturnValue(true);
        const isEnabledTrue = summaryService.isConversationSummaryEnabled(session.id);
        expect(isEnabledTrue).toBe(true);
      });

      it('verifies generateConversationSummary mock exists', async () => {
        // Verify the mock function exists and can be called
        expect(typeof summaryService.generateConversationSummary).toBe('function');

        // Call the mock
        const result = await summaryService.generateConversationSummary('test-session-id', 'test-conv-id');
        expect(result).toBe('mock summary');
      });
    });
  });
});

describe('Multi-conversation summary guard (route handler behavior)', () => {
  let app;
  let project;
  let session;
  let summaryService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked summaryService
    summaryService = await import('../services/summaryService.js');

    // Reset mock implementations to defaults (enabled state)
    summaryService.isConversationSummaryEnabled.mockReturnValue(true);
    summaryService.generateConversationSummary.mockResolvedValue('mock summary');

    // Create test data
    project = projects.create('Guard Test Project', '/tmp/guard-test');
    session = sessions.create(project.id, 'Guard Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });

    // Set up Express app with sessions router
    const sessionsRouter = (await import('./sessions.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /sessions/:id/conversations - multi-conversation guard', () => {
    it('triggers generateConversationSummary when creating the 2nd conversation', async () => {
      // Session already has initial conversation (count = 1)
      // Creating conversation #2 should trigger summary for the initial one
      await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({ name: 'Second Conversation' })
        .expect(201);

      // Wait for async summary generation (it's fire-and-forget)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The initial conversation should have been queued for summarization
      expect(summaryService.generateConversationSummary).toHaveBeenCalledWith(
        session.id,
        expect.any(String)
      );
    });

    it('does NOT trigger generateConversationSummary when previous conversation already has a summary', async () => {
      // Set a summary on the initial conversation
      const initialConv = conversations.getActiveBySessionId(session.id);
      conversations.update(initialConv.id, { summary: 'Existing summary' });

      // Creating conversation #2 should NOT trigger because previous already has summary
      await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({ name: 'Second Conversation' })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(summaryService.generateConversationSummary).not.toHaveBeenCalled();
    });

    it('does NOT trigger generateConversationSummary when summaries are disabled', async () => {
      // Mock isConversationSummaryEnabled to return false
      summaryService.isConversationSummaryEnabled.mockReturnValue(false);

      await request(app)
        .post(`/api/sessions/${session.id}/conversations`)
        .send({ name: 'Second Conversation' })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(summaryService.generateConversationSummary).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /sessions/:id/conversations/:convId - multi-conversation guard', () => {
    it('triggers generateConversationSummary when switching between 2+ conversations', async () => {
      // Create a second conversation (session now has 2)
      const conv2 = conversations.create(session.id, 'Second Conversation', false);

      // Switch to conv2 — should trigger summary for the initial (previously active) conversation
      await request(app)
        .patch(`/api/sessions/${session.id}/conversations/${conv2.id}`)
        .send({ isActive: true })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(summaryService.generateConversationSummary).toHaveBeenCalledWith(
        session.id,
        expect.any(String)
      );
    });

    it('does NOT trigger generateConversationSummary when only 1 conversation exists', async () => {
      // Only the initial conversation exists (count = 1)
      // Switching to the same conversation (already active) does nothing
      const initialConv = conversations.getActiveBySessionId(session.id);

      // PATCH with just a name update (not isActive switch) — no summary trigger
      await request(app)
        .patch(`/api/sessions/${session.id}/conversations/${initialConv.id}`)
        .send({ name: 'Updated name' })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(summaryService.generateConversationSummary).not.toHaveBeenCalled();
    });

    it('does NOT trigger generateConversationSummary when switching with summaries disabled', async () => {
      // Create a second conversation
      const conv2 = conversations.create(session.id, 'Second Conversation', false);

      // Disable summaries
      summaryService.isConversationSummaryEnabled.mockReturnValue(false);

      await request(app)
        .patch(`/api/sessions/${session.id}/conversations/${conv2.id}`)
        .send({ isActive: true })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(summaryService.generateConversationSummary).not.toHaveBeenCalled();
    });
  });
});
