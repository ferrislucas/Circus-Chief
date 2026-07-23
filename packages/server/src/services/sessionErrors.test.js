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
  turnEndedDueToLimitOrOutage,
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
        expect.stringContaining('Token threshold reached'),
        { retryExistingMessage: false }
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

  // ── turnEndedDueToLimitOrOutage ───────────────────────────────────────

  describe('turnEndedDueToLimitOrOutage', () => {
    it('detects token-limit text in the result event', () => {
      messages.getBySessionId.mockReturnValue([]);
      const resultEvent = { resultText: "You've reached your usage limit" };
      expect(turnEndedDueToLimitOrOutage('sess-1', resultEvent)).toBe(true);
    });

    it('detects service-error text (overloaded / 503 / 529 / unavailable) in the result event', () => {
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'The server is overloaded' })).toBe(true);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'HTTP 503 Service Unavailable' })).toBe(true);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'Error 529: overloaded_error' })).toBe(true);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'service unavailable' })).toBe(true);
    });

    it('does not flag bare "503"/"529" without terminal framing (completion-path prefilter)', () => {
      // The completion-path prefilter intentionally requires terminal, provider-style
      // framing (e.g. "503 service unavailable") — a bare status code alone must not
      // be classified as a usage-limit/outage termination.
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'error code 503' })).toBe(false);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'error code 529' })).toBe(false);
    });

    it('does not require the assistant-message shape guard for captured result text', () => {
      // The `result` event is the CLI's authoritative end-of-turn signal, so unlike
      // the assistant-message fallback it is never subjected to the terminal-shape
      // guard (length / implementation-verb check) — only the pattern prefilter applies.
      messages.getBySessionId.mockReturnValue([]);
      expect(
        turnEndedDueToLimitOrOutage('sess-1', { resultText: 'Fixed HTTP 503 Service Unavailable handling in the proxy' })
      ).toBe(true);
    });

    it('detects token-limit / service-error text in the last assistant message when result text is empty', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: "You've hit your token limit" },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: '' })).toBe(true);
    });

    it('detects from the last assistant message when no result event is provided', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'user', content: 'do something' },
        { role: 'assistant', content: 'Service temporarily unavailable — please try again shortly.' },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', null)).toBe(true);
    });

    it('returns false for clean result text and clean assistant message', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: 'Here is the finished implementation.' },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'Done, all tests pass.' })).toBe(false);
    });

    it('returns false with no throw when there is no result event and no assistant message', () => {
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1', null)).toBe(false);
    });

    it('prefers the result event text over the assistant message', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: 'Here is the finished implementation.' },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'usage limit reached' })).toBe(true);
    });

    it('falls back to the last assistant message when the result event has empty resultText', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: 'Quota exceeded for this billing period.' },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: '' })).toBe(true);
    });

    it('falls back to the last assistant message when the result event is missing', () => {
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: 'Too many requests — please slow down.' },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', undefined)).toBe(true);
    });

    it('returns false when there is no result event and no assistant message', () => {
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1')).toBe(false);
    });

    describe('framed terminal patterns (result event) — must return true', () => {
      const terminalTexts = [
        "You've reached your usage limit",
        "You've hit your token limit",
        'usage limit reached',
        'quota exceeded',
        'context window exceeded',
        'HTTP 503 Service Unavailable',
        'Error 529: overloaded_error',
        'The API is overloaded, please try again later',
        '429 Too Many Requests',
        'Too many requests - please try again later',
      ];

      it.each(terminalTexts)('detects: %s', (text) => {
        messages.getBySessionId.mockReturnValue([]);
        expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: text })).toBe(true);
      });
    });

    it('normalizes underscores when matching "overloaded_error"', () => {
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'overloaded_error' })).toBe(true);
    });

    it('normalizes hyphens when matching "service-unavailable"', () => {
      messages.getBySessionId.mockReturnValue([]);
      expect(turnEndedDueToLimitOrOutage('sess-1', { resultText: 'service-unavailable' })).toBe(true);
    });

    // Regression corpus: ordinary successful-work prose that incidentally contains
    // bare words also matched by matchesTokenLimitError / matchesServiceError
    // ("token", "limit", "cap", "exceeded", "503", "529", "overload", "unavailable")
    // — or even a fully-framed terminal phrase embedded inside an implementation
    // summary — must NOT be classified as a usage-limit/outage termination when it
    // arrives via the last-assistant-message fallback, where the
    // `looksLikeTerminalAssistantMessage` shape guard applies. Guards against
    // over-broad false holds.
    describe('regression corpus (natural completion text via assistant fallback, must return false)', () => {
      const cleanCompletions = [
        'implemented a token bucket rate limiter',
        'increased the pagination limit to 100',
        'added capacity checks',
        'Added an overloaded constructor for the Point class',
        'Refactored method overloading in the parser',
        'Fixed the HTTP 503 error handling in the proxy',
        'Fixed HTTP 503 Service Unavailable handling in the proxy',
        'Implemented retry on 503 responses',
        'Bumped max buffer to 529 bytes',
        'The service is unavailable branch is now covered by a test',
        'Fixed service unavailable handling in the API client',
        'Added service-unavailable handling in the API client',
      ];

      it.each(cleanCompletions)('does not flag: %s', (text) => {
        messages.getBySessionId.mockReturnValue([
          { role: 'assistant', content: text },
        ]);
        expect(turnEndedDueToLimitOrOutage('sess-1', null)).toBe(false);
      });
    });

    it('rejects a multi-paragraph completion summary that mentions "usage limit reached" as a string literal', () => {
      const longSummary = [
        'Implemented the retry handler for the billing service.',
        'This change adds a new RetryPolicy class that inspects the error string',
        'returned by the provider. For example, when the provider responds with',
        'the literal text "usage limit reached", the handler now schedules a retry',
        'instead of failing the request immediately.',
        'Added unit tests covering the new branch and updated the documentation to',
        'describe the retry behavior in detail so future maintainers understand',
        'why the string is checked, and covered the edge case where the response',
        'body is empty.',
      ].join(' ');
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: longSummary },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', null)).toBe(false);
    });

    it('rejects a completion summary with bullets that includes "429 Too Many Requests" in test-fixture text', () => {
      const bulletSummary = [
        'Implemented rate limiting for the public API:',
        '- Added a token bucket limiter in front of the router',
        '- Added a regression test asserting the client receives "429 Too Many Requests"',
        '  when the bucket is empty',
        '- Updated the changelog',
      ].join('\n');
      messages.getBySessionId.mockReturnValue([
        { role: 'assistant', content: bulletSummary },
      ]);
      expect(turnEndedDueToLimitOrOutage('sess-1', null)).toBe(false);
    });
  });
});
