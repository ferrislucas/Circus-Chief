import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages, sessionSummaries } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';

// Mock the websocket module to avoid WebSocket server dependency
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

// Import after mock setup
import * as summaryService from './summaryService.js';
import { broadcastToSession } from '../websocket.js';

describe('summaryService', () => {
  let projectId;
  let sessionId;

  beforeEach(() => {
    // Set mock mode for testing
    vi.stubEnv('MOCK_CLAUDE', 'true');

    // Clear mock call history
    vi.clearAllMocks();

    // Create test project and session
    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const session = sessions.create(projectId, 'Test Session', 'Initial prompt', 'standard');
    sessionId = session.id;
  });

  afterEach(() => {
    // Clean up any debounce timers
    summaryService.cleanupSession(sessionId);
    vi.unstubAllEnvs();
  });

  describe('generateSummary', () => {
    it('returns null for non-existent session', async () => {
      const result = await summaryService.generateSummary('non-existent-id');
      expect(result).toBeNull();
    });

    it('returns null for session with no messages', async () => {
      // Create a new session directly via database without any messages
      const now = Date.now();
      const emptySessionId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(emptySessionId, projectId, 'Empty Session', 'running', 'standard', now, now);

      const result = await summaryService.generateSummary(emptySessionId);
      expect(result).toBeNull();
    });

    it('generates summary with mock mode', async () => {
      const result = await summaryService.generateSummary(sessionId);

      expect(result).not.toBeNull();
      expect(result.sessionId).toBe(sessionId);
      expect(result.shortSummary).toBeDefined();
      expect(result.fullSummary).toBeDefined();
      expect(result.keyActions).toBeInstanceOf(Array);
      expect(result.filesModified).toBeInstanceOf(Array);
      expect(result.outcome).toBeDefined();
    });

    it('broadcasts generating status when starting', async () => {
      await summaryService.generateSummary(sessionId);

      expect(broadcastToSession).toHaveBeenCalledWith(
        sessionId,
        'session:summary_generating',
        expect.objectContaining({
          sessionId,
          generating: true,
        })
      );
    });

    it('broadcasts summary update when complete', async () => {
      await summaryService.generateSummary(sessionId);

      expect(broadcastToSession).toHaveBeenCalledWith(
        sessionId,
        'session:summary_updated',
        expect.objectContaining({
          sessionId,
          summary: expect.any(Object),
        })
      );
    });

    it('stores summary in database', async () => {
      const result = await summaryService.generateSummary(sessionId);

      const stored = sessionSummaries.getBySessionId(sessionId);
      expect(stored).not.toBeNull();
      expect(stored.id).toBe(result.id);
    });

    it('tracks message count for staleness detection', async () => {
      const result = await summaryService.generateSummary(sessionId);

      const allMessages = messages.getBySessionId(sessionId);
      expect(result.messageCount).toBe(allMessages.length);
    });

    it('uses existing summary for incremental generation', async () => {
      // Generate initial summary
      await summaryService.generateSummary(sessionId);

      // Add more messages
      messages.create(sessionId, 'assistant', 'Response content');
      messages.create(sessionId, 'user', 'Follow-up question');

      // Generate again (should do incremental update)
      const result = await summaryService.generateSummary(sessionId);

      expect(result).not.toBeNull();
      // Message count should reflect all messages
      const allMessages = messages.getBySessionId(sessionId);
      expect(result.messageCount).toBe(allMessages.length);
    });

    it('sets outcome based on session status', async () => {
      // Update session to completed status
      sessions.update(sessionId, { status: 'completed' });

      const result = await summaryService.generateSummary(sessionId);

      expect(result.outcome).toBe('completed');
    });

    it('sets outcome to failed for error status', async () => {
      sessions.update(sessionId, { status: 'error' });

      const result = await summaryService.generateSummary(sessionId);

      expect(result.outcome).toBe('failed');
    });

    it('sets outcome to ongoing for running status', async () => {
      sessions.update(sessionId, { status: 'running' });

      const result = await summaryService.generateSummary(sessionId);

      expect(result.outcome).toBe('ongoing');
    });
  });

  describe('getSummary', () => {
    it('returns null when no summary exists', async () => {
      const result = await summaryService.getSummary(sessionId);
      expect(result).toBeNull();
    });

    it('returns existing summary', async () => {
      // Create a summary first
      await summaryService.generateSummary(sessionId);

      const result = await summaryService.getSummary(sessionId);
      expect(result).not.toBeNull();
      expect(result.sessionId).toBe(sessionId);
    });

    it('does not generate when generateIfMissing is false', async () => {
      const result = await summaryService.getSummary(sessionId, false);
      expect(result).toBeNull();
    });

    it('generates summary when generateIfMissing is true and none exists', async () => {
      const result = await summaryService.getSummary(sessionId, true);
      expect(result).not.toBeNull();
      expect(result.sessionId).toBe(sessionId);
    });
  });

  describe('regenerateSummary', () => {
    it('generates a new summary', async () => {
      const result = await summaryService.regenerateSummary(sessionId);

      expect(result).not.toBeNull();
      expect(result.sessionId).toBe(sessionId);
    });

    it('updates existing summary', async () => {
      // Generate initial
      const initial = await summaryService.generateSummary(sessionId);

      // Add message and regenerate
      messages.create(sessionId, 'assistant', 'New response');
      const regenerated = await summaryService.regenerateSummary(sessionId);

      expect(regenerated.id).toBe(initial.id); // Same ID (updated, not new)
      expect(regenerated.messageCount).toBeGreaterThan(initial.messageCount);
    });
  });

  describe('isSummaryStale', () => {
    it('returns true when no summary exists', () => {
      const result = summaryService.isSummaryStale(sessionId);
      expect(result).toBe(true);
    });

    it('returns false when message count matches', async () => {
      await summaryService.generateSummary(sessionId);

      const result = summaryService.isSummaryStale(sessionId);
      expect(result).toBe(false);
    });

    it('returns true when new messages added', async () => {
      await summaryService.generateSummary(sessionId);

      // Add new message
      messages.create(sessionId, 'assistant', 'New message');

      const result = summaryService.isSummaryStale(sessionId);
      expect(result).toBe(true);
    });
  });

  describe('onSessionActivity (debounce)', () => {
    it('schedules summary generation', async () => {
      vi.useFakeTimers();

      summaryService.onSessionActivity(sessionId);

      // Summary should not be generated immediately
      expect(sessionSummaries.getBySessionId(sessionId)).toBeNull();

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(15000);

      // Now summary should be generated
      expect(sessionSummaries.getBySessionId(sessionId)).not.toBeNull();

      vi.useRealTimers();
    });

    it('resets timer on subsequent calls', async () => {
      vi.useFakeTimers();

      summaryService.onSessionActivity(sessionId);

      // Advance 10 seconds
      await vi.advanceTimersByTimeAsync(10000);
      expect(sessionSummaries.getBySessionId(sessionId)).toBeNull();

      // Call again (resets timer)
      summaryService.onSessionActivity(sessionId);

      // Advance another 10 seconds (total 20 from first call, but only 10 from second)
      await vi.advanceTimersByTimeAsync(10000);
      expect(sessionSummaries.getBySessionId(sessionId)).toBeNull();

      // Advance remaining 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(sessionSummaries.getBySessionId(sessionId)).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe('onSessionComplete', () => {
    it('generates summary immediately', async () => {
      // Use real timers for this test
      summaryService.onSessionComplete(sessionId);

      // Wait a tick for the async operation
      await new Promise(resolve => setImmediate(resolve));

      expect(sessionSummaries.getBySessionId(sessionId)).not.toBeNull();
    });

    it('cancels pending debounce timer', async () => {
      vi.useFakeTimers();

      // Start debounce timer
      summaryService.onSessionActivity(sessionId);

      // Call onSessionComplete (should cancel debounce and generate immediately)
      summaryService.onSessionComplete(sessionId);

      // Wait for async operation
      await vi.advanceTimersByTimeAsync(0);

      const summary = sessionSummaries.getBySessionId(sessionId);
      expect(summary).not.toBeNull();

      vi.useRealTimers();
    });
  });

  describe('cleanupSession', () => {
    it('cancels pending debounce timer', async () => {
      vi.useFakeTimers();

      summaryService.onSessionActivity(sessionId);
      summaryService.cleanupSession(sessionId);

      // Fast-forward past debounce time
      await vi.advanceTimersByTimeAsync(20000);

      // Summary should NOT have been generated
      expect(sessionSummaries.getBySessionId(sessionId)).toBeNull();

      vi.useRealTimers();
    });

    it('does not throw for non-existent session', () => {
      expect(() => summaryService.cleanupSession('non-existent')).not.toThrow();
    });
  });

  describe('message formatting', () => {
    it('handles messages with tool use', async () => {
      // Add a message with tool use
      messages.create(sessionId, 'assistant', 'I will read the file', null, [
        { name: 'Read', input: { path: '/tmp/test.js' } },
      ]);

      const result = await summaryService.generateSummary(sessionId);

      expect(result).not.toBeNull();
      // The mock summary should still work
      expect(result.fullSummary).toContain('mock');
    });

    it('handles very long messages by truncating', async () => {
      // Create a very long message
      const longContent = 'A'.repeat(3000);
      messages.create(sessionId, 'user', longContent);

      const result = await summaryService.generateSummary(sessionId);

      expect(result).not.toBeNull();
    });
  });
});
