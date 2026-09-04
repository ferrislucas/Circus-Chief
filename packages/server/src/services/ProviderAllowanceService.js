import { ProviderAllowanceListResponse, ProviderAllowanceSnapshot } from '@circuschief/shared/contracts/providers';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Keeps the provider-usage boundary intentionally honest. Providers without a
 * validated, authoritative allowance source are represented as unknown rather
 * than inferred from call logs or credentials.
 */
export class ProviderAllowanceService {
  constructor({ providerRepository, broadcaster = null, clock = Date }) {
    this.providerRepository = providerRepository;
    this.broadcaster = broadcaster;
    this.clock = clock;
    this.snapshots = new Map();
  }

  getSnapshots() {
    const providers = this.providerRepository.getAll().filter((provider) => provider.enabled);
    const activeIds = new Set(providers.map((provider) => provider.id));
    for (const id of this.snapshots.keys()) if (!activeIds.has(id)) this.snapshots.delete(id);

    return ProviderAllowanceListResponse.parse(providers.map((provider) => (
      this.snapshots.get(provider.id) || this.#unknownSnapshot(provider)
    )));
  }

  observe(snapshot) {
    const normalized = ProviderAllowanceSnapshot.parse(snapshot);
    const previous = this.snapshots.get(normalized.providerId);
    this.snapshots.set(normalized.providerId, normalized);
    if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
      this.broadcaster?.(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, { snapshot: normalized });
    }
    return normalized;
  }

  #unknownSnapshot(provider) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      status: 'unknown',
      allowances: [],
      source: null,
      updatedAt: null,
      staleAt: null,
      unavailableReason: 'No verified provider allowance data is available.',
    };
  }
}
