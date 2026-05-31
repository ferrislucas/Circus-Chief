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

import { isSummaryStale, isDescendantStateStale } from './summaryStaleCheck.js';
import { computeWorkflowFingerprint } from './summaryFingerprint.js';
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

  describe('isSummaryStale (own-message staleness only)', () => {
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

    // Descendant staleness — isSummaryStale no longer checks descendants.
    // Parent summaries are updated via buildMergedParentSummary (propagation pathway).
    describe('descendant changes do NOT affect isSummaryStale', () => {
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

      it('returns false even when a child session has a newer summary', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T1
          vi.setSystemTime(1000);
          const parentMsgs = messages.getBySessionId(sessionId);
          const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: parentMsgs.length,
            lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          });

          // Create child with a newer summary at T2
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
          vi.setSystemTime(2000);
          sessionSummaries.create(child.id, {
            shortSummary: 'child',
            fullSummary: 'child full',
            messageCount: 0,
          });

          // isSummaryStale only checks OWN messages — child changes don't make it stale
          // (the propagation pathway handles parent updates via buildMergedParentSummary)
          expect(isSummaryStale(sessionId)).toBe(false);

          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('returns false when descendants exist but their summaries are older', () => {
        vi.useFakeTimers();

        try {
          // Create parent summary at T2 (later)
          vi.setSystemTime(2000);
          const parentMsgs = messages.getBySessionId(sessionId);
          const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
          sessionSummaries.create(sessionId, {
            shortSummary: 'parent',
            fullSummary: 'parent full',
            messageCount: parentMsgs.length,
            lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
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

      it('returns true when message-based staleness detects stale (independent of descendants)', async () => {
        vi.useFakeTimers();

        try {
          // Generate a summary for the parent
          await summaryService.generateSummary(sessionId);

          // Create a child session (but don't generate a summary for it)
          const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });

          // Add a new message to the parent — this makes it stale by message count
          messages.create(sessionId, 'assistant', 'New message');

          // Should be stale due to parent's OWN message change
          expect(isSummaryStale(sessionId)).toBe(true);

          sessions.delete(child.id);
        } finally {
          vi.useRealTimers();
        }
      });

      it('sessions without descendants continue to use own-message staleness', () => {
        vi.useFakeTimers();

        try {
          vi.setSystemTime(1000);
          const parentMsgs = messages.getBySessionId(sessionId);
          const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
          sessionSummaries.create(sessionId, {
            shortSummary: 'Session',
            fullSummary: 'Session full',
            messageCount: parentMsgs.length,
            lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          });

          // No descendants, nothing changed → fresh
          expect(isSummaryStale(sessionId)).toBe(false);

          // Add new message to own session → stale
          messages.create(sessionId, 'assistant', 'New message');
          expect(isSummaryStale(sessionId)).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  // isDescendantStateStale is now a separate exported function for API consumers
  describe('isDescendantStateStale (exported for API consumers)', () => {
    it('returns false when no descendants exist', () => {
      const summary = sessionSummaries.create(sessionId, {
        shortSummary: 'parent',
        fullSummary: 'parent full',
        messageCount: messages.getBySessionId(sessionId).length,
      });
      expect(isDescendantStateStale(sessionId, summary)).toBe(false);
    });

    it('returns false when descendants exist but their summaries are older', () => {
      vi.useFakeTimers();

      try {
        // Create parent summary at T2 (later)
        vi.setSystemTime(2000);
        const summary = sessionSummaries.create(sessionId, {
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

        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

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
        const summary = sessionSummaries.create(sessionId, {
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

        expect(isDescendantStateStale(sessionId, summary)).toBe(true);

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
        const summary = sessionSummaries.create(sessionId, {
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

        // Create grandchild at T2 (newer — should detect stale)
        const grandchild = sessions.create(projectId, 'Grandchild', 'Prompt', { parentSessionId: child.id });
        vi.setSystemTime(2000);
        sessionSummaries.create(grandchild.id, {
          shortSummary: 'grandchild',
          fullSummary: 'grandchild full',
          messageCount: 0,
        });

        expect(isDescendantStateStale(sessionId, summary)).toBe(true);

        sessions.delete(grandchild.id);
        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    // Fingerprint-based staleness tests
    it('parent is stale when a child summary content changes even if parent generatedAt is newer than child generatedAt', () => {
      vi.useFakeTimers();

      try {
        // Create child session and summary at T1
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        vi.setSystemTime(1000);
        const childSummary = sessionSummaries.create(child.id, {
          shortSummary: 'Child initial',
          fullSummary: 'Child initial full',
          outcome: 'ongoing',
          messageCount: messages.getBySessionId(child.id).length,
        });

        // Create parent summary at T2 (later) — compute the fingerprint
        vi.setSystemTime(2000);
        const fp = computeWorkflowFingerprint(sessionId);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          workflowFingerprint: fp,
        });

        // Parent should be fresh at this point
        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // Now change child summary content — this invalidates the fingerprint
        sessionSummaries.update(childSummary.id, {
          shortSummary: 'Child completed',
          fullSummary: 'Child completed full',
          outcome: 'completed',
        });

        // Descendant state is now stale (fingerprint no longer matches)
        const refreshed = sessionSummaries.getBySessionId(sessionId);
        expect(isDescendantStateStale(sessionId, refreshed)).toBe(true);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('parent is stale when a descendant gains new messages not reflected in its summary', () => {
      vi.useFakeTimers();

      try {
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        vi.setSystemTime(1000);
        sessionSummaries.create(child.id, {
          shortSummary: 'Child',
          fullSummary: 'Child full',
          outcome: 'ongoing',
          messageCount: messages.getBySessionId(child.id).length,
        });

        vi.setSystemTime(2000);
        const fp = computeWorkflowFingerprint(sessionId);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          workflowFingerprint: fp,
        });

        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // Add a new message to the child
        messages.create(child.id, 'assistant', 'New child message');

        // Descendant state is stale (child gained a new message)
        const refreshed = sessionSummaries.getBySessionId(sessionId);
        expect(isDescendantStateStale(sessionId, refreshed)).toBe(true);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('parent with stored fingerprint remains fresh after only descendant summary timestamps change', () => {
      vi.useFakeTimers();

      try {
        // T1: create child session and child summary
        vi.setSystemTime(1000);
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        const childSummary = sessionSummaries.create(child.id, {
          shortSummary: 'Child work done',
          fullSummary: 'Child full details',
          outcome: 'completed',
          messageCount: messages.getBySessionId(child.id).length,
          lastSummarizedMessageId: null,
        });

        // T2: create parent summary with fingerprint
        vi.setSystemTime(2000);
        const fp = computeWorkflowFingerprint(sessionId);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          workflowFingerprint: fp,
        });

        // Parent should be fresh
        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // T3: update child summary with identical semantic content (only timestamps refresh).
        vi.setSystemTime(9000);
        sessionSummaries.update(childSummary.id, {
          shortSummary: 'Child work done',
          fullSummary: 'Child full details',
          outcome: 'completed',
          messageCount: messages.getBySessionId(child.id).length,
          lastSummarizedMessageId: null,
        });

        // Parent must STILL be fresh — only timestamps changed, fingerprint is unchanged
        const refreshed = sessionSummaries.getBySessionId(sessionId);
        expect(isDescendantStateStale(sessionId, refreshed)).toBe(false);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('parent with stored fingerprint becomes stale after descendant semantic summary content changes', () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(1000);
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        const childSummary = sessionSummaries.create(child.id, {
          shortSummary: 'In progress',
          fullSummary: 'Work continues',
          outcome: 'ongoing',
          messageCount: 0,
        });

        vi.setSystemTime(2000);
        const fp = computeWorkflowFingerprint(sessionId);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          workflowFingerprint: fp,
        });

        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // Update with genuinely different semantic content
        vi.setSystemTime(3000);
        sessionSummaries.update(childSummary.id, {
          shortSummary: 'Completed all tasks',
          fullSummary: 'All work is done now',
          outcome: 'completed',
        });

        // Descendant state is stale — semantic content changed, fingerprint no longer matches
        const refreshed = sessionSummaries.getBySessionId(sessionId);
        expect(isDescendantStateStale(sessionId, refreshed)).toBe(true);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('parent with stored fingerprint becomes stale after descendant message metadata changes', () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(1000);
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        sessionSummaries.create(child.id, {
          shortSummary: 'Child',
          fullSummary: 'Child full',
          outcome: 'ongoing',
          messageCount: 1,
          lastSummarizedMessageId: 'msg-001',
        });

        vi.setSystemTime(2000);
        const fp = computeWorkflowFingerprint(sessionId);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          workflowFingerprint: fp,
        });

        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // Add a new message to child — this changes descendant message metadata
        vi.setSystemTime(3000);
        messages.create(child.id, 'assistant', 'New child response');

        // Descendant state is stale — descendant lastMessageId changed, fingerprint no longer matches
        const refreshed = sessionSummaries.getBySessionId(sessionId);
        expect(isDescendantStateStale(sessionId, refreshed)).toBe(true);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('legacy summaries without fingerprints still use timestamp fallback', () => {
      vi.useFakeTimers();

      try {
        // Parent summary at T2, no fingerprint (legacy)
        vi.setSystemTime(2000);
        const parentMsgs = messages.getBySessionId(sessionId);
        const lastParentMsg = parentMsgs.length > 0 ? parentMsgs[parentMsgs.length - 1] : null;
        const summary = sessionSummaries.create(sessionId, {
          shortSummary: 'Parent',
          fullSummary: 'Parent full',
          messageCount: parentMsgs.length,
          lastSummarizedMessageId: lastParentMsg ? lastParentMsg.id : null,
          // no workflowFingerprint
        });

        // Child summary at T1 (older than parent) — timestamp check says fresh
        const child = sessions.create(projectId, 'Child', 'Prompt', { parentSessionId: sessionId });
        vi.setSystemTime(1000);
        sessionSummaries.create(child.id, {
          shortSummary: 'Child old',
          fullSummary: 'Child old full',
          outcome: 'ongoing',
          messageCount: 0,
        });

        // Timestamp fallback: child summary is older → fresh
        expect(isDescendantStateStale(sessionId, summary)).toBe(false);

        // Now add a newer child summary at T3
        const summary2 = sessionSummaries.getBySessionId(child.id);
        vi.setSystemTime(3000);
        sessionSummaries.update(summary2.id, { shortSummary: 'Child newer', outcome: 'completed' });

        // Timestamp fallback: child summary is now newer → stale
        expect(isDescendantStateStale(sessionId, summary)).toBe(true);

        sessions.delete(child.id);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
