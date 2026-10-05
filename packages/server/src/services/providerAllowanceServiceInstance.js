import { modelProviders, sessions } from '../database.js';
import { ProviderAllowanceService } from './ProviderAllowanceService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

let providerAllowanceService;

async function broadcastProviderAllowanceUpdate(...args) {
  const { broadcast } = await import('../websocket.js');
  return broadcast(...args);
}

export function invalidateProviderAllowanceList() {
  return broadcastProviderAllowanceUpdate(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_LIST_INVALIDATED, {});
}

/**
 * Persist-then-invalidate announcer shared by every provider mutation
 * endpoint. The broadcast is awaited so a failure settles here instead of
 * vanishing into an unobserved promise; failures are logged with a
 * credential-free diagnostic and never fail the mutation response, because
 * persistence has already succeeded.
 */
export async function notifyAllowanceListChangedAfterMutation({
  invalidator = invalidateProviderAllowanceList,
  logger = console,
} = {}) {
  try {
    await invalidator();
  } catch (error) {
    // Credential-free by construction: only the transport error code/name
    // is recorded, never the message or payload.
    logger.warn('[ProviderAllowances]', JSON.stringify({
      outcome: 'list-invalidation-failed',
      error: error?.code ?? error?.name ?? 'unknown',
    }));
  }
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
  const service = getProviderAllowanceService();
  return service.observe.bind(service);
}
