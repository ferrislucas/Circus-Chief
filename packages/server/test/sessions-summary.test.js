import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions, messages, sessionSummaries } from '../src/database.js';

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Import summaryService after mock setup
import * as summaryService from '../src/services/summaryService.js';

describe('Sessions Summary API', () => {
  let project;
  let session;

  beforeEach(() => {
    // Set mock mode for testing
    vi.stubEnv('MOCK_CLAUDE', 'true');
    vi.clearAllMocks();

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');

    // Add enough messages to meet MIN_MESSAGES_FOR_SUMMARY threshold (Phase 2 optimization)
    // Session creation adds 1 message (the prompt), so we need 2 more
    messages.create(session.id, 'assistant', 'Response 1');
    messages.create(session.id, 'user', 'Follow-up question');
  });

  afterEach(() => {
    summaryService.cleanupSession(session.id);
    vi.unstubAllEnvs();
  });

  describe('GET /api/sessions/:id/summary', () => {
    it('returns null when no summary exists', async () => {
      const summary = await summaryService.getSummary(session.id);
      expect(summary).toBeNull();
    });

    it('returns existing summary', async () => {
      // Create summary directly via repository
      sessionSummaries.create(session.id, {
        shortSummary: 'Test short summary',
        fullSummary: 'Test full summary with more details',
        keyActions: ['Action 1', 'Action 2'],
        filesModified: ['file1.js'],
        outcome: 'partial',
        messageCount: 3,
      });

      const summary = await summaryService.getSummary(session.id);

      expect(summary).not.toBeNull();
      expect(summary.shortSummary).toBe('Test short summary');
      expect(summary.fullSummary).toBe('Test full summary with more details');
      expect(summary.keyActions).toEqual(['Action 1', 'Action 2']);
      expect(summary.filesModified).toEqual(['file1.js']);
      expect(summary.outcome).toBe('partial');
    });

    it('generates summary when generateIfMissing is true', async () => {
      const summary = await summaryService.getSummary(session.id, true);

      expect(summary).not.toBeNull();
      expect(summary.sessionId).toBe(session.id);
    });
  });

  describe('POST /api/sessions/:id/summary', () => {
    it('generates summary for session', async () => {
      const summary = await summaryService.regenerateSummary(session.id);

      expect(summary).not.toBeNull();
      expect(summary.sessionId).toBe(session.id);
      expect(summary.shortSummary).toBeDefined();
      expect(summary.fullSummary).toBeDefined();
    });

    it('regenerates existing summary', async () => {
      // Generate initial summary
      const initial = await summaryService.generateSummary(session.id);

      // Add new message
      messages.create(session.id, 'assistant', 'New response');

      // Regenerate
      const regenerated = await summaryService.regenerateSummary(session.id);

      expect(regenerated.id).toBe(initial.id);
      expect(regenerated.messageCount).toBe(initial.messageCount + 1);
    });

    it('returns null for non-existent session', async () => {
      const summary = await summaryService.regenerateSummary('non-existent');
      expect(summary).toBeNull();
    });
  });

  describe('Summary integration with session lifecycle', () => {
    it('summary deleted when session deleted', async () => {
      // Generate summary
      await summaryService.generateSummary(session.id);
      expect(sessionSummaries.getBySessionId(session.id)).not.toBeNull();

      // Delete session
      sessions.delete(session.id);

      // Summary should be cascade deleted
      expect(sessionSummaries.getBySessionId(session.id)).toBeNull();
    });

    it('multiple sessions have independent summaries', async () => {
      // Create another session
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt 2', 'standard');

      // Add messages to session2 to meet MIN_MESSAGES_FOR_SUMMARY threshold (Phase 2)
      messages.create(session2.id, 'assistant', 'Response for session 2');
      messages.create(session2.id, 'user', 'Follow-up for session 2');

      // Generate summaries for both
      await summaryService.generateSummary(session.id);
      await summaryService.generateSummary(session2.id);

      const summary1 = sessionSummaries.getBySessionId(session.id);
      const summary2 = sessionSummaries.getBySessionId(session2.id);

      expect(summary1).not.toBeNull();
      expect(summary2).not.toBeNull();
      expect(summary1.id).not.toBe(summary2.id);
      expect(summary1.sessionId).toBe(session.id);
      expect(summary2.sessionId).toBe(session2.id);

      // Cleanup
      summaryService.cleanupSession(session2.id);
    });

    it('upsert creates new or updates existing summary', async () => {
      // First upsert - creates
      const created = sessionSummaries.upsert(session.id, {
        shortSummary: 'First',
        fullSummary: 'First full',
      });

      expect(created.shortSummary).toBe('First');

      // Second upsert - updates
      const updated = sessionSummaries.upsert(session.id, {
        shortSummary: 'Second',
        fullSummary: 'Second full',
      });

      expect(updated.id).toBe(created.id);
      expect(updated.shortSummary).toBe('Second');

      // Only one summary exists
      const allSummaries = sessionSummaries.getBySessionId(session.id);
      expect(allSummaries).not.toBeNull();
    });
  });

  describe('Summary content based on session state', () => {
    it('reflects stopped session status', async () => {
      sessions.update(session.id, { status: 'stopped' });

      const summary = await summaryService.generateSummary(session.id);

      expect(summary.outcome).toBe('partial');
    });

    it('reflects error session status', async () => {
      sessions.update(session.id, { status: 'error' });

      const summary = await summaryService.generateSummary(session.id);

      expect(summary.outcome).toBe('failed');
    });

    it('reflects running session status', async () => {
      sessions.update(session.id, { status: 'running' });

      const summary = await summaryService.generateSummary(session.id);

      expect(summary.outcome).toBe('ongoing');
    });

    it('reflects waiting session status', async () => {
      sessions.update(session.id, { status: 'waiting' });

      const summary = await summaryService.generateSummary(session.id);

      expect(summary.outcome).toBe('ongoing');
    });
  });

  describe('Staleness detection', () => {
    it('new summary is not stale', async () => {
      await summaryService.generateSummary(session.id);

      expect(summaryService.isSummaryStale(session.id)).toBe(false);
    });

    it('summary becomes stale when messages added', async () => {
      await summaryService.generateSummary(session.id);

      // Add new message
      messages.create(session.id, 'user', 'New question');

      expect(summaryService.isSummaryStale(session.id)).toBe(true);
    });

    it('regenerating updates staleness', async () => {
      await summaryService.generateSummary(session.id);

      messages.create(session.id, 'user', 'New question');
      expect(summaryService.isSummaryStale(session.id)).toBe(true);

      await summaryService.regenerateSummary(session.id);
      expect(summaryService.isSummaryStale(session.id)).toBe(false);
    });

    it('no summary is considered stale', () => {
      expect(summaryService.isSummaryStale(session.id)).toBe(true);
    });
  });
});
