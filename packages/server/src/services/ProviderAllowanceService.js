import { ProviderAllowanceListResponse, ProviderAllowanceSnapshot } from '@circuschief/shared/contracts/providers';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { isDeepStrictEqual } from 'node:util';

/**
 * Keeps the provider-usage boundary intentionally honest. Providers without a
 * validated, authoritative allowance source are represented as unknown rather
 * than inferred from call logs or credentials.
 */
export class ProviderAllowanceService {
  constructor({ providerRepository, sessionRepository = null, broadcaster = null, clock = Date }) {
    this.providerRepository = providerRepository;
    this.sessionRepository = sessionRepository;
    this.broadcaster = broadcaster;
    this.clock = clock;
    this.snapshots = new Map();
  }

  getSnapshots() {
    const providers = this.#enabledProviders();
    const activeIds = new Set(providers.map((provider) => provider.id));
    for (const id of this.snapshots.keys()) if (!activeIds.has(id)) this.snapshots.delete(id);

    const snapshots = ProviderAllowanceListResponse.parse(providers.map((provider) =>
      withFreshness(this.#normalizeSnapshot(this.snapshots.get(provider.id), provider), this.clock.now()),
    ));
    const activeProviderIds = new Set(
      (this.sessionRepository?.getActiveAndWaiting() || []).map((session) => session.providerId).filter(Boolean),
    );
    return prioritizeSnapshots(snapshots, activeProviderIds);
  }

  observe(snapshot) {
    const provider = this.#enabledProviders().find((candidate) => candidate.id === snapshot?.providerId);
    if (!provider) return null;
    const normalized = this.#normalizeSnapshot(snapshot, provider);
    const previous = this.snapshots.get(normalized.providerId);
    this.snapshots.set(normalized.providerId, normalized);
    if (!isDeepStrictEqual(previous, normalized)) {
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

  #normalizeSnapshot(snapshot, provider) {
    if (!snapshot || typeof snapshot !== 'object') return this.#unknownSnapshot(provider);

    const allowances = Array.isArray(snapshot.allowances)
      ? snapshot.allowances.map(normalizeAllowance).filter(Boolean)
      : [];
    const authoritativePercentages = allowances.map((allowance) => allowance.remainingPercent).filter((value) => value !== null);
    const hasAuthoritativePercentage = authoritativePercentages.length > 0;

    return ProviderAllowanceSnapshot.parse({
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      status: hasAuthoritativePercentage ? deriveStatus(Math.min(...authoritativePercentages)) : 'unknown',
      allowances,
      source: isSource(snapshot.source) ? snapshot.source : null,
      updatedAt: finiteNumberOrNull(snapshot.updatedAt),
      staleAt: finiteNumberOrNull(snapshot.staleAt),
      unavailableReason: typeof snapshot.unavailableReason === 'string' ? snapshot.unavailableReason : null,
    });
  }

  #enabledProviders() {
    return this.providerRepository.getEnabledForAllowances?.()
      ?? this.providerRepository.getAll().filter((provider) => provider.enabled);
  }
}

// Adapter values are untrusted. A percentage exists only when it can be
// derived from a non-negative remaining amount and a positive limit.
export function normalizeAllowance(allowance) {
  if (!hasDisplayIdentity(allowance)) return null;

  const remaining = finiteNumberOrNull(allowance.remaining);
  const limit = finiteNumberOrNull(allowance.limit);
  const normalizedRemaining = remaining === null ? null : Math.max(0, remaining);
  const normalizedLimit = limit !== null && limit > 0 ? limit : null;
  const remainingPercent = normalizedRemaining !== null && normalizedLimit !== null
    ? percentage(normalizedRemaining, normalizedLimit)
    : null;

  return {
    key: allowance.key,
    label: allowance.label,
    remaining: normalizedRemaining,
    limit: normalizedLimit,
    remainingPercent,
    unit: allowance.unit,
    resetsAt: finiteNumberOrNull(allowance.resetsAt),
  };
}

function hasDisplayIdentity(allowance) {
  return allowance && typeof allowance === 'object'
    && typeof allowance.key === 'string' && Boolean(allowance.key)
    && typeof allowance.label === 'string' && Boolean(allowance.label)
    && isUnit(allowance.unit);
}

export function percentage(remaining, limit) {
  return Math.min(100, Math.max(0, (remaining / limit) * 100));
}

// Status thresholds apply to the most depleted authoritative allowance.
export const ALLOWANCE_STATUS_THRESHOLDS = Object.freeze({ warning: 50, critical: 10 });

export function deriveStatus(remainingPercent) {
  if (remainingPercent <= 0) return 'exhausted';
  if (remainingPercent <= ALLOWANCE_STATUS_THRESHOLDS.critical) return 'critical';
  if (remainingPercent <= ALLOWANCE_STATUS_THRESHOLDS.warning) return 'warning';
  return 'available';
}

function finiteNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isUnit(value) {
  return ['tokens', 'requests', 'credits', 'other'].includes(value);
}

function isSource(value) {
  return ['provider', 'observed-header', 'configured'].includes(value);
}

export function withFreshness(snapshot, now) {
  return snapshot.staleAt !== null && snapshot.staleAt <= now && snapshot.status !== 'stale'
    ? { ...snapshot, status: 'stale' }
    : snapshot;
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
