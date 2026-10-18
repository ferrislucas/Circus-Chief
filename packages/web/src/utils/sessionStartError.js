/**
 * Actionable copy for session-start failures.
 *
 * A tier exhausted at startup arrives with `code: 'MODEL_TIER_EXHAUSTED'`
 * (and usually `tierName`) — see ModelTierExhaustedError server-side and
 * ApiClient's error forwarding. Those get tier-specific guidance plus a
 * pointer at Model Tiers settings; everything else keeps its raw message.
 */

export const TIER_EXHAUSTED_CODE = 'MODEL_TIER_EXHAUSTED';

/**
 * @param {*} err - The error thrown by session creation.
 * @returns {boolean} Whether this is a tier-exhaustion failure.
 */
export function isTierExhaustedError(err) {
  return err?.code === TIER_EXHAUSTED_CODE;
}

/**
 * @param {*} err - The error thrown by session creation.
 * @returns {string} The message to display.
 */
export function formatSessionStartError(err) {
  const fallback = err?.message || 'Failed to create session';
  if (!isTierExhaustedError(err)) return fallback;
  const tier = err.tierName ? `Model tier "${err.tierName}"` : 'The selected model tier';
  return `${tier} couldn't start this session — every member failed. Adjust its members or pick another model.`;
}
