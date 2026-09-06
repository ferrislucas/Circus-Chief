import { modelProviders, sessions } from '../database.js';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';
import { isProviderAllowancesEnabled } from '../config/providerAllowances.js';

let providerAllowanceService;

async function broadcastProviderAllowanceUpdate(...args) {
  const { broadcast } = await import('../websocket.js');
  return broadcast(...args);
}

export function getProviderAllowanceService() {
  if (!providerAllowanceService) {
    providerAllowanceService = new ProviderAllowanceService({
      providerRepository: modelProviders,
      sessionRepository: sessions,
      broadcaster: broadcastProviderAllowanceUpdate,
    });
  }
  return providerAllowanceService;
}

export function getProviderAllowanceObserver() {
  if (!isProviderAllowancesEnabled()) return null;
  const service = getProviderAllowanceService();
  return service.observe.bind(service);
}
