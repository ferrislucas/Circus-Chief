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

    // Descendant staleness tests
    describe('descendant staleness', () => {
      it('returns false when no descendants exist', async () => {
        await summaryService.generateSummary(sessionId);

        // Session has no children — descendant check is skipped
        expect(isSummaryStale(sessionId)).toBe(false);
      });

      it('returns false when descendants exist but have no summaries', async () => {
        await summaryService.generateSummary(sessionId);

        // Create a child session with no summary
        const child = sessions.create(projectId, 'Child Session', 'Child prompt', { parentSessionId: sessionId });

        try {
          expect(isSummaryStale(sessionId)).toBe(false);
        } finally {
          sessions.delete(child.id);
        }
      });

      it('returns false when descendants exist but their summaries are older', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T2 (later)
          vi.setSystemTime(2000);
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: messages.getBySessionId(sessionId).length,
          });

          // Create child summary at T1 (earlier)
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
          vi.setSystemTime(1000);
          sessionSummaries.create(child.id, {
            shortSummary: 'child',
            fullSummary: 'child full',
            messageCount: 0,
          });

          expect(isSummaryStale(sessionId)).toBe(false);

          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns true when a child session has a newer summary', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T1
          vi.setSystemTime(1000);
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: messages.getBySessionId(sessionId).length,
          });

          // Create child with a newer summary at T2
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
          vi.setSystemTime(2000);
          sessionSummaries.create(child.id, {
            shortSummary: 'child',
            fullSummary: 'child full',
            messageCount: 0,
          });

          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns true when a grandchild session has a newer summary', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T1
          vi.setSystemTime(1000);
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: messages.getBySessionId(sessionId).length,
          });

          // Create child at T1 (same time, not stale)
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
          vi.setSystemTime(1000);
          sessionSummaries.create(child.id, {
            shortSummary: 'child',
            fullSummary: 'child full',
            messageCount: 0,
          });

          // Create grandchild at T2 (newer — should make parent stale)
          const grandchild = sessions.create(projectId, 'Grandchild', 'Prompt', { parentSessionId: child.id });
          vi.setSystemTime(2000);
          sessionSummaries.create(grandchild.id, {
            shortSummary: 'grandchild',
            fullSummary: 'grandchild full',
            messageCount: 0,
          });

          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(grandchild.id);
          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns true when a great-grandchild has a newer summary', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T1
          vi.setSystemTime(1000);
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: messages.getBySessionId(sessionId).length,
          });

          // Build a 4-level deep hierarchy
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
          const grandchild = sessions.create(projectId, 'Grandchild', 'Prompt', { parentSessionId: child.id });
          const greatGrandchild = sessions.create(projectId, 'GGC', 'Prompt', { parentSessionId: grandchild.id });

          // Great-grandchild has a newer summary at T2
          vi.setSystemTime(2000);
          sessionSummaries.create(greatGrandchild.id, {
            shortSummary: 'great-grandchild',
            fullSummary: 'great-grandchild full',
            messageCount: 0,
          });

          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(greatGrandchild.id);
          sessions.delete(grandchild.id);
          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns true when multiple descendants have newer summaries', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T1
          vi.setSystemTime(1000);
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: messages.getBySessionId(sessionId).length,
          });

          // Create child A with newer summary at T2
          const childA = sessions.create(projectId, 'Child A', 'Prompt', { parentSessionId: sessionId });
          vi.setSystemTime(2000);
          sessionSummaries.create(childA.id, {
            shortSummary: 'child A',
            fullSummary: 'child A full',
            messageCount: 0,
          });

          // Create grandchild B with even newer summary at T3
          const childB = sessions.create(projectId, 'Child B', 'Prompt', { parentSessionId: sessionId });
          const grandchildB = sessions.create(projectId, 'Grandchild B', 'Prompt', { parentSessionId: childB.id });
          vi.setSystemTime(3000);
          sessionSummaries.create(grandchildB.id, {
            shortSummary: 'grandchild B',
            fullSummary: 'grandchild B full',
            messageCount: 0,
          });

          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(grandchildB.id);
          sessions.delete(childB.id);
          sessions.delete(childA.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns true when message-based staleness already detects stale', async () => {
        vi.useFakeTimers();

        try {
          // Generate a summary for the parent
          await summaryService.generateSummary(sessionId);

          // Create a child session (but don't generate a summary for it)
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });

          // Add a new message to the parent — this makes it stale by message count
          messages.create(sessionId, 'assistant', 'New message');

          // Should be stale due to message change, even before checking descendants
          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
