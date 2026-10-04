import { describe, it, expect, beforeEach, vi } from 'vitest';

// The matchers under test transitively import the database and scheduler;
// mirror the module mocks from sessionErrors.test.js so this suite exercises
// only the pure detection vocabulary.
vi.mock('../database.js', () => ({
  sessions: { getById: vi.fn() },
  messages: { getBySessionId: vi.fn() },
}));

vi.mock('./schedulerService.js', () => ({
  schedulerService: {
    hasReachedLimits: vi.fn(),
    rescheduleSession: vi.fn(),
  },
}));

import { messages } from '../database.js';
import {
  matchesTokenLimitError,
  matchesServiceError,
  matchesStartFailoverEligibleError,
  turnEndedDueToLimitOrOutage,
} from './sessionErrors.js';
import { SESSION_ERROR_FIXTURES } from './sessionErrorFixtures.js';

/**
 * Conformance suite over the pinned real-string fixture corpus
 * (sessionErrorFixtures.js).
 *
 * For EVERY fixture row, the expected verdicts are asserted against the
 * exported matchers in sessionErrors.js:
 *
 *   - failoverEligible: true  ⇒ the tight failover gate matches AND the broad
 *     reschedule trigger pair matches (BOTH-policies agreement: a string that
 *     should fail over must never be silently swallowed by auto-reschedule on
 *     the same model — the incident ec5b56d5 failure chain).
 *   - failoverEligible: false ⇒ the tight failover gate does not match.
 *   - rescheduleTrigger: true ⇒ the broad reschedule pair
 *     (matchesTokenLimitError OR matchesServiceError) matches.
 *   - rescheduleTrigger: false ⇒ neither broad matcher matches.
 *   - weak-signal rows additionally pin matchesTokenLimitError === true with
 *     the failover gate false — the deliberate precision difference between
 *     the two policies.
 *   - prose-guard rows pin the completion-path shape guard
 *     (turnEndedDueToLimitOrOutage === false); the failover gate structurally
 *     never sees assistant prose.
 *
 * This is the widened FR-4 subset invariant (previously covering only the
 * framed completion patterns vs the shared matchers), now covering the
 * failover gate. Adding a row here never touches logic; changing the
 * vocabulary in sessionErrors.js cannot silently unpin a known real string.
 */
describe('sessionErrors conformance — fixture corpus (pinned real provider strings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messages.getBySessionId.mockReturnValue([]);
  });

  it('the corpus is non-empty and every row is well-formed', () => {
    expect(SESSION_ERROR_FIXTURES.length).toBeGreaterThan(0);
    for (const fixture of SESSION_ERROR_FIXTURES) {
      expect(typeof fixture.message).toBe('string');
      expect(fixture.message.length).toBeGreaterThan(0);
      expect(typeof fixture.source).toBe('string');
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(['quota', 'service', 'weak-signal', 'prompt-size', 'terminal', 'prose-guard']).toContain(fixture.kind);
      expect([true, false, null]).toContain(fixture.failoverEligible);
      expect([true, false, null]).toContain(fixture.rescheduleTrigger);
    }
  });

  it('every strong-signal row (fail over AND reschedule) satisfies BOTH policies', () => {
    for (const fixture of SESSION_ERROR_FIXTURES) {
      if (fixture.failoverEligible !== true || fixture.rescheduleTrigger !== true) continue;
      const lower = fixture.message.toLowerCase();
      expect(
        matchesTokenLimitError(lower) || matchesServiceError(lower),
        `fixture from ${fixture.source} is failover-eligible but misses the broad reschedule trigger — it would be swallowed by auto-reschedule on the same model (incident ec5b56d5 failure chain)`
      ).toBe(true);
      expect(matchesStartFailoverEligibleError(lower)).toBe(true);
    }
  });

  describe('pinned asymmetries between the two policies', () => {
    const failoverBroader = SESSION_ERROR_FIXTURES.filter(
      (f) => f.failoverEligible === true && f.rescheduleTrigger === false
    );
    const rescheduleBroader = SESSION_ERROR_FIXTURES.filter(
      (f) => f.failoverEligible === false && f.rescheduleTrigger === true
    );

    it('both asymmetry families are present in the corpus', () => {
      // Reschedule-broader: weak signals (incl. 'Unexpected token in JSON').
      expect(rescheduleBroader.length).toBeGreaterThan(0);
      // Failover-broader: explicit credit/quota phrasing without a weak keyword.
      expect(failoverBroader.length).toBeGreaterThan(0);
    });

    it.each(rescheduleBroader)(
      'reschedule-broader: "$message" → broad pair true, failover gate false (cheap retry yes, provider switch NO)',
      (fixture) => {
        const lower = fixture.message.toLowerCase();
        expect(matchesTokenLimitError(lower) || matchesServiceError(lower)).toBe(true);
        expect(matchesStartFailoverEligibleError(lower)).toBe(false);
      }
    );

    it.each(failoverBroader)(
      'failover-broader: "$message" → failover gate true, broad pair false (quota semantics per PRD F16; reschedule vocabulary untouched)',
      (fixture) => {
        const lower = fixture.message.toLowerCase();
        expect(matchesStartFailoverEligibleError(lower)).toBe(true);
        expect(matchesTokenLimitError(lower) || matchesServiceError(lower)).toBe(false);
      }
    );
  });

  it.each(SESSION_ERROR_FIXTURES.filter((f) => f.failoverEligible !== null))(
    '$kind: "$message" → failover gate verdict $failoverEligible',
    (fixture) => {
      expect(matchesStartFailoverEligibleError(fixture.message.toLowerCase())).toBe(fixture.failoverEligible);
    }
  );

  it.each(SESSION_ERROR_FIXTURES.filter((f) => f.rescheduleTrigger !== null))(
    '$kind: "$message" → broad reschedule trigger verdict $rescheduleTrigger',
    (fixture) => {
      const lower = fixture.message.toLowerCase();
      expect(matchesTokenLimitError(lower) || matchesServiceError(lower)).toBe(fixture.rescheduleTrigger);
    }
  );

  describe('weak-signal rows pin the deliberate precision difference (reschedule yes, fail over NO)', () => {
    const weakSignalRows = SESSION_ERROR_FIXTURES.filter((f) => f.kind === 'weak-signal');

    it('the family is present in the corpus', () => {
      expect(weakSignalRows.length).toBeGreaterThan(0);
    });

    it.each(weakSignalRows)('"%s" → matchesTokenLimitError true, failover gate false', (fixture) => {
      const lower = fixture.message.toLowerCase();
      expect(matchesTokenLimitError(lower)).toBe(true);
      expect(matchesStartFailoverEligibleError(lower)).toBe(false);
    });
  });

  describe('prompt-size rows pin the deliberate failover exclusion (reschedule yes, fail over NO)', () => {
    const promptSizeRows = SESSION_ERROR_FIXTURES.filter((f) => f.kind === 'prompt-size');

    it('the family is present in the corpus', () => {
      expect(promptSizeRows.length).toBeGreaterThan(0);
    });

    it.each(promptSizeRows)('"%s" → reschedules, failover gate false', (fixture) => {
      const lower = fixture.message.toLowerCase();
      expect(matchesTokenLimitError(lower) || matchesServiceError(lower)).toBe(true);
      expect(matchesStartFailoverEligibleError(lower)).toBe(false);
    });
  });

  describe('prose-guard rows pin the completion-path shape guard (turnEndedDueToLimitOrOutage stays false)', () => {
    const proseRows = SESSION_ERROR_FIXTURES.filter((f) => f.kind === 'prose-guard');

    it('the family is present in the corpus', () => {
      expect(proseRows.length).toBeGreaterThan(0);
    });

    it.each(proseRows)('completion path does not flag: "%s"', (fixture) => {
      expect(turnEndedDueToLimitOrOutage('sess-conformance', { resultText: fixture.message })).toBe(false);
    });
  });

  describe('quota/service rows are strong signals for BOTH policies', () => {
    const strongRows = SESSION_ERROR_FIXTURES.filter(
      (f) => (f.kind === 'quota' || f.kind === 'service') && f.failoverEligible === true && f.rescheduleTrigger === true
    );

    it('the family is present in the corpus', () => {
      expect(strongRows.length).toBeGreaterThan(0);
    });

    it.each(strongRows)('"%s" → failover true AND reschedule true', (fixture) => {
      const lower = fixture.message.toLowerCase();
      expect(matchesStartFailoverEligibleError(lower)).toBe(true);
      expect(matchesTokenLimitError(lower) || matchesServiceError(lower)).toBe(true);
    });
  });
});
