import { modelProviders } from '../database.js';
import { broadcast } from '../websocket.js';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';

export const providerAllowanceService = new ProviderAllowanceService({
  providerRepository: modelProviders,
  broadcaster: broadcast,
});
