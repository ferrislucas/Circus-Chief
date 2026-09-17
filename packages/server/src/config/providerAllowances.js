/**
 * Rollout gate for provider allowance collection and presentation.
 *
 * Only the literal `1` is an opt-in. This keeps a typo from silently exposing
 * an unvalidated provider integration.
 */
export function isProviderAllowancesEnabled() {
  return process.env.PROVIDER_ALLOWANCES_ENABLED === '1';
}
