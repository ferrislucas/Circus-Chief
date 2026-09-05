import { ProviderAllowanceListResponse, ProviderAllowanceSnapshot } from '@circuschief/shared/contracts/providers';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Keeps the provider-usage boundary intentionally honest. Providers without a
 * validated, authoritative allowance source are represented as unknown rather
 * than inferred from call logs or credentials.
 */
export class ProviderAllowanceService {
  constructor({ providerRepository, sessionRepository = null, broadcaster = null, clock = Date, isEnabled = () => true }) {
    this.providerRepository = providerRepository;
    this.sessionRepository = sessionRepository;
    this.broadcaster = broadcaster;
    this.clock = clock;
    this.isEnabled = isEnabled;
    this.snapshots = new Map();
  }

  getSnapshots() {
    if (!this.isEnabled()) return [];
    const providers = this.providerRepository.getAll().filter((provider) => provider.enabled);
    const activeIds = new Set(providers.map((provider) => provider.id));
    for (const id of this.snapshots.keys()) if (!activeIds.has(id)) this.snapshots.delete(id);

    const snapshots = ProviderAllowanceListResponse.parse(providers.map((provider) => (
      this.snapshots.get(provider.id) || this.#unknownSnapshot(provider)
    )));
    const activeProviderIds = new Set(
      (this.sessionRepository?.getActiveAndWaiting() || []).map((session) => session.providerId).filter(Boolean),
    );
    return prioritizeSnapshots(snapshots, activeProviderIds);
  }

  observe(snapshot) {
    if (!this.isEnabled()) return null;
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

const ATTENTION_STATUSES = new Set(['warning', 'critical', 'exhausted']);

/**
 * Preserves configured order within each priority group so REST and websocket
 * consumers share deterministic ordering without exposing session details.
 */
export function prioritizeSnapshots(snapshots, activeProviderIds) {
  return [...snapshots].sort((left, right) => priority(left, activeProviderIds) - priority(right, activeProviderIds));
}

function priority(snapshot, activeProviderIds) {
  if (activeProviderIds.has(snapshot.providerId)) return 0;
  return ATTENTION_STATUSES.has(snapshot.status) ? 1 : 2;
}
