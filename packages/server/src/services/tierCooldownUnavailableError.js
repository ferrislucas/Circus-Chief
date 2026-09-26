/**
 * Return the common cooldown-exhaustion error used by both session startup
 * and summary-tier dispatch. A configured tier is still the user's selected
 * model policy while its members cool down, so callers must not substitute an
 * unrelated default model in this case.
 */
export function createTierCooldownUnavailableError(tierId, tierName) {
  const error = new Error(`No healthy member is currently available for tier "${tierName}" (all members are cooling down)`);
  Object.assign(error, { code: 'MODEL_TIER_COOLDOWN_UNAVAILABLE', tierId, tierName });
  return error;
}
