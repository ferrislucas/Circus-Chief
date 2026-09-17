import { describe, it, expect, beforeEach, vi } from 'vitest';

// e2eSpawnOutcomes.js itself is data + fs plumbing with no heavy imports, but
// binding its outcome sets to the DETECTION matchers pulls in
// sessionErrors.js, which transitively imports the database and scheduler.
// Mirror the module mocks from sessionErrors.test.js.
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

import {
  OUTCOME_MESSAGES,
  FAILOVER_ELIGIBLE_OUTCOME_TYPES,
  TERMINAL_ERROR_OUTCOME_TYPES,
} from './e2eSpawnOutcomes.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';
import { SESSION_ERROR_FIXTURES, findFixtureByMessage } from './sessionErrorFixtures.js';

/**
 * Bindings between the E2E scripted-outcome vocabulary and the production
 * detection vocabulary.
 *
 * The original incident (ec5b56d5) slipped through because the E2E suite's
 * canned quota wording matched the pattern lists while the real production
 * wording did not. These tests close that gap permanently:
 *
 *   1. Every failover-eligible outcome's canned message MUST satisfy the
 *      tight failover gate — so a scripted quota/service failure really
 *      exercises the failover path.
 *   2. Every terminal-error outcome's canned message MUST NOT satisfy it —
 *      so the negative E2E journeys (auth/bad-request never fail over) stay
 *      meaningful.
 *   3. Every canned message MUST exist in the sessionErrorFixtures corpus
 *      with the SAME classification — so the E2E fixtures and the conformance
 *      corpus can never drift apart again.
 *   4. Every outcome type MUST have exactly one canned message and belong to
 *      exactly one outcome set — no orphan/unroutable outcome types.
 */
describe('e2eSpawnOutcomes — scripted wording is bound to production detection semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('every outcome type has exactly one canned message and belongs to exactly one outcome set', () => {
    const allOutcomeTypes = new Set([
      ...FAILOVER_ELIGIBLE_OUTCOME_TYPES,
      ...TERMINAL_ERROR_OUTCOME_TYPES,
    ]);

    for (const type of Object.keys(OUTCOME_MESSAGES)) {
      expect(allOutcomeTypes.has(type), `${type} has a canned message but no outcome set`).toBe(true);
    }
    for (const type of allOutcomeTypes) {
      expect(typeof OUTCOME_MESSAGES[type]).toBe('string');
      expect(OUTCOME_MESSAGES[type].length).toBeGreaterThan(0);
    }
  });

  describe('every FAILOVER_ELIGIBLE outcome message satisfies matchesStartFailoverEligibleError', () => {
    it.each([...FAILOVER_ELIGIBLE_OUTCOME_TYPES])('%s', (type) => {
      expect(
        matchesStartFailoverEligibleError(OUTCOME_MESSAGES[type].toLowerCase()),
        `${type} is scripted as failover-eligible but its canned message does not satisfy the production failover gate — the E2E suite would pass while production wording fails (the incident ec5b56d5 gap)`
      ).toBe(true);
    });
  });

  describe('every TERMINAL_ERROR outcome message does NOT satisfy matchesStartFailoverEligibleError', () => {
    it.each([...TERMINAL_ERROR_OUTCOME_TYPES])('%s', (type) => {
      expect(
        matchesStartFailoverEligibleError(OUTCOME_MESSAGES[type].toLowerCase()),
        `${type} is scripted as terminal but its canned message satisfies the production failover gate — the negative E2E journeys would be vacuous`
      ).toBe(false);
    });
  });

  describe('every canned message is pinned in the fixture corpus with the same classification', () => {
    it.each(Object.keys(OUTCOME_MESSAGES))('%s', (type) => {
      const message = OUTCOME_MESSAGES[type];
      const fixture = findFixtureByMessage(message);
      expect(
        fixture,
        `${type}'s canned message is missing from sessionErrorFixtures.js — add it there so the corpus stays the single table of record`
      ).toBeDefined();

      const expectedFailover = FAILOVER_ELIGIBLE_OUTCOME_TYPES.has(type);
      expect(
        fixture.failoverEligible,
        `${type}'s corpus classification disagrees with its outcome set`
      ).toBe(expectedFailover);
      expect(
        fixture.rescheduleTrigger,
        `${type}'s corpus classification disagrees with its outcome set (failover-eligible outcomes must also be reschedule triggers; terminal outcomes must not)`
      ).toBe(expectedFailover);
    });
  });

  it('the corpus contains the real incident string as a quota fixture', () => {
    const incidentFixture = findFixtureByMessage(OUTCOME_MESSAGES.quota_error);
    expect(incidentFixture?.kind).toBe('quota');
    expect(incidentFixture?.failoverEligible).toBe(true);
  });
});
