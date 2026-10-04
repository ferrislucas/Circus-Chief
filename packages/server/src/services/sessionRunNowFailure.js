const RUN_NOW_FAILURES = {
  lane_run_ownership_lost: { status: 409, error: 'Session no longer owns an active lane run', code: 'LANE_RUN_OWNERSHIP_LOST' },
  invalid_executor_response: { status: 502, error: 'Scheduled session executor returned an invalid start result', code: 'INVALID_EXECUTOR_RESPONSE' },
  executor_declined: { status: 409, error: 'Scheduled session executor declined to start the session', code: 'EXECUTOR_DECLINED' },
  launch_budget_exhausted: { status: 409, error: 'Scheduled launch refused: session has reached its max total token budget', code: 'LAUNCH_BUDGET_EXHAUSTED' },
};

/** Convert executor rejection reasons into stable, non-sensitive API errors. */
export function runNowFailureResponse(reason) {
  return RUN_NOW_FAILURES[reason] || {
    status: 502,
    error: 'Scheduled session executor failed to start the session',
    code: 'SCHEDULED_EXECUTOR_START_FAILED',
  };
}
