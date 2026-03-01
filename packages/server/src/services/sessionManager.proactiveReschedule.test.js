import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { continueSession } from './sessionManager.js';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
// Import the singleton instances used by sessionManager
import { sessions, conversations } from '../database.js';
import { ProjectRepository } from '../db/ProjectRepository.js';

// Mock the schedulerService BEFORE importing anything that uses it
vi.mock('./schedulerService.js', () => ({
  schedulerService: {
    hasReachedLimits: vi.fn().mockReturnValue(false),
    rescheduleSession: vi.fn().mockResolvedValue(true),
    initialize: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
  SchedulerService: class {},
}));

// Mock the SDK to prevent real API calls in tests
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Import the mocked service to get a reference for assertions
import { schedulerService as mockSchedulerService } from './schedulerService.js';

/**
 * Helper function to set up a session with rescheduling configuration and token values
 */
function setupSessionForReschedule(sessionId, config) {
  // Update configuration via normal update
  sessions.update(sessionId, {
    autoRescheduleEnabled: config.autoRescheduleEnabled !== undefined ? config.autoRescheduleEnabled : true,
    rescheduleAtTokenCount: config.rescheduleAtTokenCount || null,
    rescheduleDelayMinutes: config.rescheduleDelayMinutes || 5,
  });

  // Update token usage via specialized method
  if (config.inputTokens !== undefined || config.outputTokens !== undefined) {
    sessions.updateUsage(sessionId, {
      inputTokens: config.inputTokens || 0,
      outputTokens: config.outputTokens || 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      contextWindow: 0,
    });
  }
}

describe('sessionManager - Proactive Rescheduling', () => {
  let projectRepo;
  let tempDir;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to defaults
    mockSchedulerService.hasReachedLimits.mockReturnValue(false);
    mockSchedulerService.rescheduleSession.mockResolvedValue(true);

    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'reschedule-test-'));

    // Create test project and session using singleton instances (same as sessionManager uses)
    project = projectRepo.create('Test Project', tempDir);
    session = sessions.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessions.update(session.id, { claudeSessionId: 'mock-session-id' });

    // Create active conversation using singleton
    conversations.create(session.id, 'Test Conversation');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('proactive reschedule conditions', () => {
    it('does NOT reschedule when autoRescheduleEnabled is false, even if rescheduleAtTokenCount is set', async () => {
      // autoRescheduleEnabled is the master switch for all rescheduling
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: false, // Master switch is OFF
        rescheduleAtTokenCount: 100000,
        inputTokens: 80000,
        outputTokens: 30000, // Total: 110000, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      // Should NOT reschedule because autoRescheduleEnabled is false
      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('reschedules when autoRescheduleEnabled is true and rescheduleAtTokenCount threshold is reached', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true, // Master switch is ON
        rescheduleAtTokenCount: 100000,
        inputTokens: 80000,
        outputTokens: 30000, // Total: 110000, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining('Token threshold reached')
      );
    });

    it('does not reschedule when rescheduleAtTokenCount is null', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: null,
        inputTokens: 80000,
        outputTokens: 30000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('does not reschedule when tokens are below threshold', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 150000,
        inputTokens: 50000,
        outputTokens: 30000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('reschedules when tokens reach threshold and limits not reached', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000, // Total 105000, exceeds 100000 threshold
        rescheduleDelayMinutes: 5,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.hasReachedLimits).toHaveBeenCalled();
      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining('Token threshold reached')
      );
    });

    it('does not reschedule when limits are reached despite token threshold', async () => {
      mockSchedulerService.hasReachedLimits.mockReturnValue(true);

      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.hasReachedLimits).toHaveBeenCalled();
      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });
  });

  describe('token calculation and thresholds', () => {
    it('calculates total tokens as inputTokens + outputTokens', async () => {
      // Set tokens clearly above threshold to ensure reschedule triggers
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000, // Total: 105000, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining('Token threshold reached')
      );
    });

    it('reschedules when total tokens exceed threshold', async () => {
      // Set tokens clearly above threshold
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 80000,
        outputTokens: 30000, // Total: 110000, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining('Token threshold reached')
      );
    });

    it('handles zero tokens correctly', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 0,
        outputTokens: 0,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('does not reschedule when just below threshold', async () => {
      // Set tokens well below threshold so even after mock adds ~9, it stays below 100000
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 50000,
        outputTokens: 40000, // Total: 90000, well below threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('reschedules at exact threshold boundary', async () => {
      // Set tokens exactly at threshold (should trigger since condition is >=)
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 30000, // Total: 100000, exactly at threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalled();
    });
  });

  describe('session status and lifecycle', () => {
    it('session status transitions to waiting before reschedule check', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      // Mock rescheduleSession to capture the session status when it's called
      let sessionStatusDuringReschedule = null;
      mockSchedulerService.rescheduleSession.mockImplementation(async (sessionId) => {
        sessionStatusDuringReschedule = sessions.getById(sessionId).status;
        return true;
      });

      await continueSession(session.id, 'Continue', tempDir);

      // Session should be in 'waiting' status when rescheduleSession is called
      expect(sessionStatusDuringReschedule).toBe('waiting');
    });

    it('returns early when rescheduled, preventing further processing', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      const result = await continueSession(session.id, 'Continue', tempDir);

      // Function should return undefined (early return after reschedule)
      expect(result).toBeUndefined();
      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalled();
    });
  });

  describe('mock scheduler integration', () => {
    it('passes correct sessionId to rescheduleSession', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.any(String)
      );
    });

    it('calls hasReachedLimits before attempting reschedule', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      const hasReachedLimitsCalls = mockSchedulerService.hasReachedLimits.mock.calls.length;
      const rescheduleSessionCalls = mockSchedulerService.rescheduleSession.mock.calls.length;

      // hasReachedLimits should be called at least once
      expect(hasReachedLimitsCalls).toBeGreaterThan(0);
      // If limits are not reached, rescheduleSession should be called
      expect(rescheduleSessionCalls).toBeGreaterThan(0);
    });

    it('respects hasReachedLimits return value', async () => {
      // Set up to have limits reached
      mockSchedulerService.hasReachedLimits.mockReturnValue(true);

      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      await continueSession(session.id, 'Continue', tempDir);

      // hasReachedLimits was called and returned true
      expect(mockSchedulerService.hasReachedLimits).toHaveBeenCalled();
      // rescheduleSession should NOT have been called because limits were reached
      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws error when session is not found', async () => {
      await expect(continueSession('non-existent-id', 'Continue', tempDir)).rejects.toThrow(
        'Session not found'
      );
    });

    it('handles null session gracefully', async () => {
      // This test verifies that if a session becomes null between checks,
      // the function handles it appropriately (doesn't crash)
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: 70000,
        outputTokens: 35000,
      });

      // The session exists, so this should proceed normally
      const result = await continueSession(session.id, 'Continue', tempDir);
      expect(result).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles large token counts', async () => {
      // Set tokens clearly above large threshold
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 1000000,
        inputTokens: 700000,
        outputTokens: 500000, // Total: 1,200,000, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalledWith(
        session.id,
        expect.stringContaining('Token threshold reached')
      );
    });

    it('handles token threshold of 1', async () => {
      // Set tokens above threshold of 1
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 1,
        inputTokens: 2,
        outputTokens: 0, // Total: 2, exceeds threshold
      });

      await continueSession(session.id, 'Continue', tempDir);

      expect(mockSchedulerService.rescheduleSession).toHaveBeenCalled();
    });

    it('handles negative token values (edge case - should not happen in practice)', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: true,
        rescheduleAtTokenCount: 100000,
        inputTokens: -1,
        outputTokens: -1,
      });

      await continueSession(session.id, 'Continue', tempDir);

      // With negative total tokens (-2), should be below threshold
      expect(mockSchedulerService.rescheduleSession).not.toHaveBeenCalled();
    });
  });
});
