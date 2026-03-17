import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, conversations, settings } from '../database.js';

// Mock the websocket module
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock the agentCallLogger
vi.mock('./agentCallLogger.js', () => ({
  agentCallLogger: {
    startCall: vi.fn().mockReturnValue('mock-call-id'),
    updateUsage: vi.fn(),
    completeCall: vi.fn(),
  },
}));

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'test-session' };
    yield {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'StructuredOutput',
            input: {
              summary: 'Mock conversation summary',
              short_summary: 'Mock session summary',
              full_summary: 'Mock full session summary',
              key_actions: ['Test action'],
              files_modified: ['test.js'],
              outcome: 'ongoing',
              pr_url: null,
              session_title: 'Mock: Test',
              conversation_summary: 'Mock conversation summary for combined',
            },
          },
        ],
      },
    };
    yield { type: 'result', subtype: 'success' };
  }),
}));

// Mock VCR wrapper
vi.mock('../agents/vcr/VCRSummaryWrapper.js', () => ({
  createVCRQueryFn: vi.fn(),
}));

// Mock ghService
vi.mock('./ghService.js', () => ({
  getPrInfo: vi.fn().mockResolvedValue({
    merged: false,
    state: 'open',
    hasMergeConflicts: false,
    ciStatus: 'success',
  }),
  isGhAvailable: vi.fn().mockResolvedValue(true),
}));

import { isConversationSummaryEnabled, generateConversationSummary } from './conversationSummary.js';
import { broadcastToSession } from '../websocket.js';

describe('conversationSummary', () => {
  let projectId, sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const session = sessions.create(projectId, 'Test Session', 'Test prompt', 'standard');
    sessionId = session.id;

    // Enable conversation summaries for tests (default is disabled)
    settings.setSummarySettings({
      disableSessionSummaries: false,
      disableConversationSummaries: false,
      sessionTitlePrompt: '',
    });
  });

  describe('isConversationSummaryEnabled', () => {
    it('returns true when conversation summaries are enabled', () => {
      expect(isConversationSummaryEnabled(sessionId)).toBe(true);
    });

    it('returns false when disabled globally', () => {
      settings.setSummarySettings({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });
      expect(isConversationSummaryEnabled(sessionId)).toBe(false);
    });

    it('returns false for non-existent session', () => {
      expect(isConversationSummaryEnabled('non-existent')).toBe(false);
    });
  });

  describe('generateConversationSummary', () => {
    let conversationId;

    beforeEach(() => {
      // Create a conversation with enough messages
      const conversation = conversations.create(sessionId, 'Test Conversation');
      conversationId = conversation.id;

      // Add messages to meet minimum threshold (4 messages for conversation)
      messages.create(sessionId, 'user', 'Message 1', { conversationId });
      messages.create(sessionId, 'assistant', 'Response 1', { conversationId });
      messages.create(sessionId, 'user', 'Message 2', { conversationId });
      messages.create(sessionId, 'assistant', 'Response 2', { conversationId });
    });

    it('generates summary for a conversation', async () => {
      const result = await generateConversationSummary(sessionId, conversationId);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('broadcasts conversation summary update', async () => {
      await generateConversationSummary(sessionId, conversationId);

      expect(broadcastToSession).toHaveBeenCalledWith(
        sessionId,
        'conversation:summary_updated',
        expect.objectContaining({
          sessionId,
          conversationId,
        })
      );
    });

    it('returns null for non-existent session', async () => {
      const result = await generateConversationSummary('non-existent', conversationId);
      expect(result).toBeNull();
    });

    it('returns null for non-existent conversation', async () => {
      const result = await generateConversationSummary(sessionId, 'non-existent');
      expect(result).toBeNull();
    });

    it('returns null when conversation summaries are disabled globally', async () => {
      settings.setSummarySettings({
        disableSessionSummaries: false,
        disableConversationSummaries: true,
        sessionTitlePrompt: '',
      });

      const result = await generateConversationSummary(sessionId, conversationId);
      expect(result).toBeNull();
    });

    it('skips conversations with fewer than 4 messages', async () => {
      // Create a short conversation
      const shortConv = conversations.create(sessionId, 'Short Conversation');
      messages.create(sessionId, 'user', 'Hello', { conversationId: shortConv.id });
      messages.create(sessionId, 'assistant', 'Hi', { conversationId: shortConv.id });

      const result = await generateConversationSummary(sessionId, shortConv.id);
      expect(result).toBeNull();
    });

    it('returns null for conversation with zero messages', async () => {
      const emptyConv = conversations.create(sessionId, 'Empty Conversation');
      const result = await generateConversationSummary(sessionId, emptyConv.id);
      expect(result).toBeNull();
    });

    it('returns null when conversation belongs to different session', async () => {
      const otherSession = sessions.create(projectId, 'Other Session', 'Other prompt', 'standard');
      const otherConv = conversations.create(otherSession.id, 'Other Conv');

      const result = await generateConversationSummary(sessionId, otherConv.id);
      expect(result).toBeNull();
    });
  });
});
