import { modelProviders } from '../database.js';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';

let providerAllowanceService;

async function broadcastProviderAllowanceUpdate(...args) {
  const { broadcast } = await import('../websocket.js');
  return broadcast(...args);
}

export function getProviderAllowanceService() {
  if (!providerAllowanceService) {
    providerAllowanceService = new ProviderAllowanceService({
      providerRepository: modelProviders,
      broadcaster: broadcastProviderAllowanceUpdate,
    });
  }
  return providerAllowanceService;
}
