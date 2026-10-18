/**
 * Terminal outcome when every eligible member of a summary-bound tier failed
 * with a retryable error (parity with the session-start path's
 * `ModelTierExhaustedError`). Carries the ordered attempt list so the failure
 * reads as "this tier was exhausted", not as a single member's error; the
 * original final provider error is preserved as `cause`.
 */
export class SummaryTierExhaustedError extends Error {
  /**
   * @param {{ tierRef: string, tierName: string, attempts: Array<{providerId: string, modelId: string, reason: string}>, cause?: Error|null }} ctx
   */
  constructor({ tierRef, tierName, attempts, cause = null }) {
    const rendered = attempts
      .map(({ providerId, modelId, reason }) => `${providerId}/${modelId} — ${reason}`)
      .join('; ');
    super(`Summary tier "${tierName}" exhausted all members. Attempts: ${rendered}.`, { cause });
    this.name = 'SummaryTierExhaustedError';
    this.code = 'MODEL_TIER_EXHAUSTED';
    this.tierRef = tierRef;
    this.tierName = tierName;
    this.attempts = attempts;
  }
}
