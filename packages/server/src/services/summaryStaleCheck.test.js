import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, sessionSummaries } from '../database.js';

// Mock the websocket module to avoid WebSocket server dependency
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

// Mock the SDK to prevent real API calls in tests
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* (queryParams) {
    const prompt = queryParams?.prompt || '';
    const sessionStatusMatch = prompt.match(/Current session status:\s*(\w+)/i);
    const sessionStatus = sessionStatusMatch ? sessionStatusMatch[1] : 'running';

    let outcome = 'ongoing';
    if (sessionStatus === 'stopped') outcome = 'partial';
    if (sessionStatus === 'error') outcome = 'failed';
    if (sessionStatus === 'completed') outcome = 'completed';

    yield { type: 'system', subtype: 'init', session_id: 'test-session' };
    yield {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'StructuredOutput',
            input: {
              short_summary: 'Test session completed successfully',
              full_summary: 'This is a test session completed using mock mode',
              key_actions: ['Executed test', 'Verified output'],
              files_modified: ['test.js'],
              outcome,
              pr_url: null,
              session_title: 'Mock: Test Session',
            },
          },
        ],
      },
    };
    yield { type: 'result', subtype: 'success' };
  }),
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
  resetGhAvailableCache: vi.fn(),
  extractPrInfo: vi.fn(),
  validatePrRepository: vi.fn(),
}));

import { isSummaryStale } from './summaryStaleCheck.js';
import * as summaryService from './summaryService.js';

describe('summaryStaleCheck', () => {
  let projectId;
  let sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const session = sessions.create(projectId, 'Test Session', 'Initial prompt', 'standard');
    sessionId = session.id;

    // Add enough messages to pass MIN_MESSAGES_FOR_SUMMARY threshold (3 messages)
    // Session creation adds 1 message, so we need 2 more
    messages.create(sessionId, 'assistant', 'Response 1');
    messages.create(sessionId, 'user', 'Follow-up message');
  });

  describe('isSummaryStale', () => {
    it('returns true when no summary exists', () => {
      const result = isSummaryStale(sessionId);
      expect(result).toBe(true);
    });

    it('returns false when message count matches', async () => {
      await summaryService.generateSummary(sessionId);

      const result = isSummaryStale(sessionId);
      expect(result).toBe(false);
    });

    it('returns true when new messages added', async () => {
      await summaryService.generateSummary(sessionId);

      // Add new message
      messages.create(sessionId, 'assistant', 'New message');

      const result = isSummaryStale(sessionId);
      expect(result).toBe(true);
    });

    it('uses message ID for staleness detection when available', async () => {
      // Generate initial summary
      await summaryService.generateSummary(sessionId);

      // Summary should not be stale immediately
      expect(isSummaryStale(sessionId)).toBe(false);

      // Add a new message (this changes the last message ID)
      messages.create(sessionId, 'assistant', 'New response');

      // Summary should now be stale (detected via message ID mismatch)
      expect(isSummaryStale(sessionId)).toBe(true);
    });

    it('falls back to count-based staleness detection for old summaries', async () => {
      // Generate a summary
      await summaryService.generateSummary(sessionId);

      // Manually update the summary to remove lastSummarizedMessageId (simulating old summary)
      const summary = sessionSummaries.getBySessionId(sessionId);
      sessionSummaries.update(summary.id, { lastSummarizedMessageId: null });

      // Summary should not be stale
      expect(isSummaryStale(sessionId)).toBe(false);

      // Add a new message
      messages.create(sessionId, 'assistant', 'New message');

      // Summary should be stale (detected via count mismatch, the fallback)
      expect(isSummaryStale(sessionId)).toBe(true);
    });

    it('correctly handles empty sessions (no messages)', async () => {
      // Create a new project and session with no messages
      const testProject = projects.create('Empty Test Project', '/tmp/empty-test');
      const newSession = sessions.create(testProject.id, 'Empty Session', '', 'standard');

      // Should create a minimal summary instead of returning null
      const result = await summaryService.generateSummary(newSession.id);
      expect(result).not.toBeNull();
      expect(result.shortSummary).toBe('Session in progress');
      // sessions.create() adds the initial prompt as a message, so we have 1 message
      expect(result.fullSummary).toBe('Session with 1 message');
      expect(result.messageCount).toBe(1);

      // isSummaryStale should return false (summary now exists)
      expect(isSummaryStale(newSession.id)).toBe(false);

      // Cleanup
      sessions.delete(newSession.id);
      projects.delete(testProject.id);
    });
  });
});
