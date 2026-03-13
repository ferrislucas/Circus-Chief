import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
  },
}));

vi.mock('./schedulerService.js', () => ({
  schedulerService: {
    hasReachedLimits: vi.fn(),
    rescheduleSession: vi.fn(),
  },
}));

import { sessions, messages } from '../database.js';
import { schedulerService } from './schedulerService.js';
import {
  matchesTokenLimitError,
  matchesServiceError,
  shouldRescheduleOnError,
  _checkProactiveReschedule,
} from './sessionErrors.js';

describe('sessionErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── matchesTokenLimitError ────────────────────────────────────────────

  describe('matchesTokenLimitError', () => {
    it('matches "token" pattern', () => {
      expect(matchesTokenLimitError('maximum token limit exceeded')).toBe(true);
    });

    it('matches "context length" pattern', () => {
      expect(matchesTokenLimitError('context length exceeded')).toBe(true);
    });

    it('matches "max_tokens" pattern', () => {
      expect(matchesTokenLimitError('max_tokens reached')).toBe(true);
    });

    it('matches "context window" pattern', () => {
      expect(matchesTokenLimitError('context window is full')).toBe(true);
    });

    it('matches "limit" pattern', () => {
      expect(matchesTokenLimitError("You've hit your limit")).toBe(true);
    });

    it('matches "quota" pattern', () => {
      expect(matchesTokenLimitError('quota exhausted')).toBe(true);
    });

    it('matches "rate limit" pattern', () => {
      expect(matchesTokenLimitError('rate limit reached')).toBe(true);
    });

    it('matches "exceeded" pattern', () => {
      expect(matchesTokenLimitError('usage exceeded for this billing period')).toBe(true);
    });

    it('matches "cap" pattern', () => {
      expect(matchesTokenLimitError('usage cap reached')).toBe(true);
    });

    it('returns false for unrelated messages', () => {
      expect(matchesTokenLimitError('something went wrong')).toBe(false);
      expect(matchesTokenLimitError('network error')).toBe(false);
    });
  });

  // ── matchesServiceError ───────────────────────────────────────────────

  describe('matchesServiceError', () => {
    it('matches "overloaded" pattern', () => {
      expect(matchesServiceError('server is overloaded')).toBe(true);
    });

    it('matches "rate limit" pattern', () => {
      expect(matchesServiceError('rate limit exceeded')).toBe(true);
    });

    it('matches "503" pattern', () => {
      expect(matchesServiceError('error code 503')).toBe(true);
    });

    it('matches "529" pattern', () => {
      expect(matchesServiceError('error code 529')).toBe(true);
    });

    it('matches "unavailable" pattern', () => {
      expect(matchesServiceError('server unavailable')).toBe(true);
    });

    it('matches "service unavailable" pattern', () => {
      expect(matchesServiceError('service unavailable right now')).toBe(true);
    });

    it('matches "too many requests" pattern', () => {
      expect(matchesServiceError('too many requests')).toBe(true);
    });

    it('returns false for unrelated messages', () => {
      expect(matchesServiceError('syntax error in code')).toBe(false);
      expect(matchesServiceError('file not found')).toBe(false);
    });
  });

  // ── shouldRescheduleOnError ───────────────────────────────────────────

  describe('shouldRescheduleOnError', () => {
    it('returns false when autoRescheduleEnabled is false', () => {
      const session = {
        autoRescheduleEnabled: false,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      };
      const error = new Error('token limit exceeded');
      expect(shouldRescheduleOnError(session, error)).toBe(false);
    });

    it('returns true for token limit error when rescheduleOnTokenLimit is true', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: false,
      };
      const error = new Error('token limit exceeded');
      expect(shouldRescheduleOnError(session, error)).toBe(true);
    });

    it('returns false for token limit error when rescheduleOnTokenLimit is false', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
      };
      const error = new Error('token limit exceeded');
      expect(shouldRescheduleOnError(session, error)).toBe(false);
    });

    it('returns true for service error when rescheduleOnServiceError is true', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: true,
      };
      const error = new Error('Service unavailable. Error code: 503');
      expect(shouldRescheduleOnError(session, error)).toBe(true);
    });

    it('returns false for service error when rescheduleOnServiceError is false', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
      };
      const error = new Error('Service unavailable. Error code: 503');
      expect(shouldRescheduleOnError(session, error)).toBe(false);
    });

    it('returns false for unrecognized error', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      };
      const error = new Error('Something unexpected happened');
      expect(shouldRescheduleOnError(session, error)).toBe(false);
    });

    it('checks last assistant message for token limit when sessionId provided', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: false,
      };
      const error = new Error('generic error');
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: "You've hit your token limit" },
      ]);
      expect(shouldRescheduleOnError(session, error, 'sess-1')).toBe(true);
    });

    it('checks last assistant message for service error when sessionId provided', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: true,
      };
      const error = new Error('generic error');
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: 'The server is overloaded right now' },
      ]);
      expect(shouldRescheduleOnError(session, error, 'sess-1')).toBe(true);
    });

    it('returns false when no assistant messages match', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      };
      const error = new Error('generic error');
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: 'Here is some normal code output' },
      ]);
      expect(shouldRescheduleOnError(session, error, 'sess-1')).toBe(false);
    });

    it('handles error when getting last assistant message', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      };
      const error = new Error('generic error');
      messages.getBySessionId.mockImplementation(() => {
        throw new Error('DB error');
      });
      // Should not throw, just return false
      expect(shouldRescheduleOnError(session, error, 'sess-1')).toBe(false);
    });

    it('handles no assistant messages', () => {
      const session = {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
      };
      const error = new Error('generic error');
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'hello' },
      ]);
      expect(shouldRescheduleOnError(session, error, 'sess-1')).toBe(false);
    });
  });

  // ── _checkProactiveReschedule ─────────────────────────────────────────

  describe('_checkProactiveReschedule', () => {
    it('returns false when session not found', async () => {
      sessions.getById.mockReturnValue(null);
      expect(await _checkProactiveReschedule('sess-1')).toBe(false);
    });

    it('returns false when rescheduleAtTokenCount is not set', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: null,
        autoRescheduleEnabled: true,
        inputTokens: 100,
        outputTokens: 100,
      });
      expect(await _checkProactiveReschedule('sess-1')).toBe(false);
    });

    it('returns false when autoRescheduleEnabled is false', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: 1000,
        autoRescheduleEnabled: false,
        inputTokens: 500,
        outputTokens: 600,
      });
      expect(await _checkProactiveReschedule('sess-1')).toBe(false);
    });

    it('returns false when tokens are below threshold', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: 10000,
        autoRescheduleEnabled: true,
        inputTokens: 3000,
        outputTokens: 2000,
      });
      expect(await _checkProactiveReschedule('sess-1')).toBe(false);
    });

    it('reschedules when tokens reach threshold', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: 5000,
        autoRescheduleEnabled: true,
        inputTokens: 3000,
        outputTokens: 2500,
      });
      schedulerService.hasReachedLimits.mockReturnValue(false);
      schedulerService.rescheduleSession.mockResolvedValue(true);

      const result = await _checkProactiveReschedule('sess-1');
      expect(result).toBe(true);
      expect(schedulerService.rescheduleSession).toHaveBeenCalledWith(
        'sess-1',
        expect.stringContaining('Token threshold reached')
      );
    });

    it('returns false when limits have been reached', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: 5000,
        autoRescheduleEnabled: true,
        inputTokens: 3000,
        outputTokens: 2500,
      });
      schedulerService.hasReachedLimits.mockReturnValue(true);

      const result = await _checkProactiveReschedule('sess-1');
      expect(result).toBe(false);
      expect(schedulerService.rescheduleSession).not.toHaveBeenCalled();
    });

    it('reschedules when tokens exactly equal threshold', async () => {
      sessions.getById.mockReturnValue({
        rescheduleAtTokenCount: 5000,
        autoRescheduleEnabled: true,
        inputTokens: 2500,
        outputTokens: 2500,
      });
      schedulerService.hasReachedLimits.mockReturnValue(false);
      schedulerService.rescheduleSession.mockResolvedValue(true);

      const result = await _checkProactiveReschedule('sess-1');
      expect(result).toBe(true);
    });
  });
});
