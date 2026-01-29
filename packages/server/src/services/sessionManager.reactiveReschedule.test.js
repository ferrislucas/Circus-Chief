import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

// Import the mocked service to get a reference for assertions
import { schedulerService as mockSchedulerService } from './schedulerService.js';

/**
 * Helper function to set up a session with rescheduling configuration
 */
function setupSessionForReschedule(sessionId, config) {
  sessions.update(sessionId, {
    autoRescheduleEnabled: config.autoRescheduleEnabled !== undefined ? config.autoRescheduleEnabled : false,
    rescheduleOnTokenLimit: config.rescheduleOnTokenLimit !== undefined ? config.rescheduleOnTokenLimit : true,
    rescheduleOnServiceError: config.rescheduleOnServiceError !== undefined ? config.rescheduleOnServiceError : true,
    rescheduleDelayMinutes: config.rescheduleDelayMinutes || 15,
    maxRescheduleCount: config.maxRescheduleCount || null,
    maxTotalTokens: config.maxTotalTokens || null,
  });
}

/**
 * Helper to create a mock error that will trigger rescheduling
 */
function createTokenLimitError() {
  const error = new Error('This request exceeds the maximum token limit: 200000');
  error.name = 'TokenLimitError';
  return error;
}

function createServiceError() {
  const error = new Error('Service unavailable. Error code: 503');
  error.name = 'ServiceError';
  return error;
}

describe('sessionManager - Reactive Rescheduling (Error Handling)', () => {
  let projectRepo;
  let tempDir;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to defaults
    mockSchedulerService.hasReachedLimits.mockReturnValue(false);
    mockSchedulerService.rescheduleSession.mockResolvedValue(true);
    process.env.MOCK_CLAUDE = 'true';

    projectRepo = new ProjectRepository();

    tempDir = mkdtempSync(join(tmpdir(), 'reactive-reschedule-test-'));

    // Create test project and session using singleton instances
    project = projectRepo.create('Test Project', tempDir);
    session = sessions.create(project.id, 'Test Session', 'Test prompt', 'standard');
    sessions.update(session.id, { claudeSessionId: 'mock-session-id' });

    // Create active conversation using singleton
    conversations.create(session.id, 'Test Conversation');
  });

  afterEach(() => {
    delete process.env.MOCK_CLAUDE;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('token limit error rescheduling', () => {
    it('reschedules when rescheduleOnTokenLimit is true and token error occurs', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnTokenLimit: true,
      });

      // Mock runSession to throw a token limit error
      // We'll simulate this by manually calling the error handling path
      const error = createTokenLimitError();

      // Simulate the error being caught in runSession
      // We need to import shouldRescheduleOnError to test it directly
      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      expect(shouldReschedule).toBe(true);
    });

    it('does not reschedule when rescheduleOnTokenLimit is false', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnTokenLimit: false,
      });

      const error = createTokenLimitError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      expect(shouldReschedule).toBe(false);
    });

    it('detects various token limit error patterns', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnTokenLimit: true,
      });

      const { shouldRescheduleOnError } = await import('./sessionManager.js');
      const sessionData = sessions.getById(session.id);

      // Test different error messages
      const errorPatterns = [
        'This request exceeds the maximum token limit',
        'Context length exceeded',
        'max_tokens parameter is too large',
        'context window full',
      ];

      for (const pattern of errorPatterns) {
        const error = new Error(pattern);
        const shouldReschedule = shouldRescheduleOnError(sessionData, error);
        expect(shouldReschedule).toBe(true);
      }
    });
  });

  describe('service error rescheduling', () => {
    it('reschedules when rescheduleOnServiceError is true and service error occurs', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnServiceError: true,
      });

      const error = createServiceError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      expect(shouldReschedule).toBe(true);
    });

    it('does not reschedule when rescheduleOnServiceError is false', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnServiceError: false,
      });

      const error = createServiceError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      expect(shouldReschedule).toBe(false);
    });

    it('detects various service error patterns', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnServiceError: true,
      });

      const { shouldRescheduleOnError } = await import('./sessionManager.js');
      const sessionData = sessions.getById(session.id);

      // Test different error messages
      const errorPatterns = [
        'Service is overloaded',
        'Rate limit exceeded',
        '503 Service Unavailable',
        '529 Too many requests',
        'Service temporarily unavailable',
      ];

      for (const pattern of errorPatterns) {
        const error = new Error(pattern);
        const shouldReschedule = shouldRescheduleOnError(sessionData, error);
        expect(shouldReschedule).toBe(true);
      }
    });
  });

  describe('autoRescheduleEnabled does not block reactive rescheduling', () => {
    it('reschedules on token limit even when autoRescheduleEnabled is false', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: false,
        rescheduleOnTokenLimit: true,
      });

      const error = createTokenLimitError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      // After fix: autoRescheduleEnabled should NOT block specific triggers
      expect(shouldReschedule).toBe(true);
    });

    it('reschedules on service error even when autoRescheduleEnabled is false', async () => {
      setupSessionForReschedule(session.id, {
        autoRescheduleEnabled: false,
        rescheduleOnServiceError: true,
      });

      const error = createServiceError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      // After fix: autoRescheduleEnabled should NOT block specific triggers
      expect(shouldReschedule).toBe(true);
    });
  });

  describe('non-reschedulable errors', () => {
    it('does not reschedule for regular errors', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      });

      const error = new Error('Some other error that should not trigger rescheduling');

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);
      const shouldReschedule = shouldRescheduleOnError(sessionData, error);

      expect(shouldReschedule).toBe(false);
    });

    it('does not reschedule when both triggers are disabled', async () => {
      setupSessionForReschedule(session.id, {
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
      });

      const tokenError = createTokenLimitError();
      const serviceError = createServiceError();

      const { shouldRescheduleOnError } = await import('./sessionManager.js');

      const sessionData = sessions.getById(session.id);

      expect(shouldRescheduleOnError(sessionData, tokenError)).toBe(false);
      expect(shouldRescheduleOnError(sessionData, serviceError)).toBe(false);
    });
  });
});
