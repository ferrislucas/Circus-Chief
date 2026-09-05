import { settings } from '../database.js';

export const PROVIDER_ALLOWANCE_INDICATORS_SETTING = 'provider_allowance_indicators_v1';

/** The rollout flag is deliberately opt-in until provider adapters exist. */
export function areProviderAllowanceIndicatorsEnabled() {
  return settings.get(PROVIDER_ALLOWANCE_INDICATORS_SETTING) === 'true';
}
