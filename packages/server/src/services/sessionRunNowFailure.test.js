import { describe, expect, it } from 'vitest';
import { runNowFailureResponse } from './sessionRunNowFailure.js';

describe('runNowFailureResponse', () => {
  it.each([
    ['lane_run_ownership_lost', 409, 'LANE_RUN_OWNERSHIP_LOST'],
    ['invalid_executor_response', 502, 'INVALID_EXECUTOR_RESPONSE'],
    ['executor_declined', 409, 'EXECUTOR_DECLINED'],
    ['launch_budget_exhausted', 409, 'LAUNCH_BUDGET_EXHAUSTED'],
    ['future_provider_reason', 502, 'SCHEDULED_EXECUTOR_START_FAILED'],
  ])('preserves the appropriate API error for %s', (reason, status, code) => {
    expect(runNowFailureResponse(reason)).toEqual(expect.objectContaining({ status, code }));
  });
});
