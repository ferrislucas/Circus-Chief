import { ProviderAllowanceListResponse, ProviderAllowanceSnapshot, ProviderAllowanceStatus } from '@circuschief/shared/contracts/providers';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { isDeepStrictEqual } from 'node:util';
import { finiteNumber, percentage, requirePercent } from './allowanceNumbers.js';
import { validEpochMs } from './allowanceTime.js';

export { percentage, requirePercent } from './allowanceNumbers.js';

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

    // Recency is a session-domain fact: MAX(sessions.updated_at) per
    // provider. Active (`starting`/`running`) sessions naturally carry the
    // freshest timestamps, so the old "active first" intent is preserved as
    // a consequence of recency rather than as a special group.
    const lastUsedAt = this.sessionRepository?.getProviderLastUsedAt?.() ?? {};
    const snapshots = providers.map((provider) =>
      withFreshness(this.#normalizeSnapshot(this.snapshots.get(provider.id), provider, lastUsedAt), this.clock.now()),
    );
    // Retained for badge/trigger and probe-gating consumers; it is no longer
    // an ordering input for the dialog.
    const activeProviderIds = new Set(this.sessionRepository?.getExecutingProviderIds?.() || []);
    return ProviderAllowanceListResponse.parse({
      snapshots: prioritizeSnapshots(snapshots),
      activeProviderIds: [...activeProviderIds],
    });
  }

  observe(snapshot) {
    const provider = this.#enabledProviders().find((candidate) => candidate.id === snapshot?.providerId);
    if (!provider) return null;
    if (!this.#candidateTargetsProvider(snapshot, provider)) return null;
    const normalized = this.#normalizeSnapshot(
      snapshot, provider, this.sessionRepository?.getProviderLastUsedAt?.() ?? {},
    );
    const previous = this.snapshots.get(normalized.providerId);
    this.snapshots.set(normalized.providerId, normalized);
    if (!isDeepStrictEqual(previous, normalized)) {
      this.broadcaster?.(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, { snapshot: withFreshness(normalized, this.clock.now()) });
    }
    return normalized;
  }

  // A candidate that declares a provider kind must agree with the provider it
  // is attached to — a mismatch means a wiring mistake, and storing it would
  // broadcast one provider's allowance data as another's. Candidates without
  // a kind (future configured-budget sources) are accepted; normalization
  // re-stamps the provider's own kind.
  #candidateTargetsProvider(candidate, provider) {
    return candidate?.providerKind === undefined || candidate.providerKind === provider.kind;
  }

  #unknownSnapshot(provider, lastUsedAt = {}) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      status: 'unknown',
      allowances: [],
      source: null,
      updatedAt: null,
      staleAt: null,
      lastUsedAt: this.#recencyFor(provider, lastUsedAt),
      unavailableReason: 'No verified provider allowance data is available.',
    };
  }

  // Recency never comes from the allowance candidate: frames carry no
  // usage signal. The live session-domain projection wins whenever it has
  // the provider — a stored stamp goes stale as soon as newer session
  // activity lands, and reads must not serve it. The stored stamp survives
  // only as a fallback for providers with no session rows (e.g. deleted
  // sessions), so a missing projection never resets recency to null.
  #recencyFor(provider, lastUsedAt) {
    return finiteNumber(lastUsedAt?.[provider.id])
      ?? finiteNumber(this.snapshots.get(provider.id)?.lastUsedAt);
  }

  #normalizeSnapshot(snapshot, provider, lastUsedAt = {}) {
    if (!snapshot || typeof snapshot !== 'object') return this.#unknownSnapshot(provider, lastUsedAt);

    const allowances = Array.isArray(snapshot.allowances)
      ? snapshot.allowances.map(normalizeAllowance).filter(Boolean)
      : [];
    const authoritativePercentages = allowances.map((allowance) => allowance.remainingPercent).filter((value) => value !== null);
    const hasAuthoritativePercentage = authoritativePercentages.length > 0;

    const updatedAt = finiteNumber(snapshot.updatedAt);
    // Percentages are strictly more informative than a status hint, so they
    // always win. Status-only sources (a rate-limit event without utilization)
    // keep their mapped state instead of collapsing to unknown; anything else
    // stays honestly unknown.
    const status = hasAuthoritativePercentage
      ? deriveStatus(Math.min(...authoritativePercentages))
      : (isProviderAllowanceStatus(snapshot.status) ? snapshot.status : 'unknown');
    return ProviderAllowanceSnapshot.parse({
      providerId: provider.id,
      providerName: provider.name,
      providerKind: provider.kind,
      status,
      allowances,
      source: isSource(snapshot.source) ? snapshot.source : null,
      updatedAt,
      staleAt: calculateStaleAt(snapshot, updatedAt),
      lastUsedAt: this.#recencyFor(provider, lastUsedAt),
      unavailableReason: typeof snapshot.unavailableReason === 'string' ? snapshot.unavailableReason : null,
    });
  }

  #enabledProviders() {
    return this.providerRepository.getEnabledForAllowances?.()
      ?? this.providerRepository.getAll().filter((provider) => provider.enabled);
  }
}

function calculateStaleAt(snapshot, updatedAt) {
  const staleAfterMs = finiteNumber(snapshot.staleAfterMs);
  if (updatedAt !== null && staleAfterMs !== null) return updatedAt + staleAfterMs;
  return finiteNumber(snapshot.staleAt);
}

// Adapter values are untrusted. A percentage exists when it can be derived
// from a non-negative remaining amount and a positive limit; percentage-only
// sources (subscription plans report utilization without absolute counts)
// may supply one directly, which is accepted only when finite and in range.
export function normalizeAllowance(allowance) {
  if (!hasDisplayIdentity(allowance)) return null;

  const { remaining, value, valueKind } = normalizeAbsoluteValue(allowance);
  const limit = finiteNumber(allowance.limit);
  const normalizedLimit = limit !== null && limit > 0 ? limit : null;
  const remainingForPercent = remainingForPercentage(value, valueKind, normalizedLimit, remaining);
  const derived = remainingForPercent !== null && normalizedLimit !== null
    ? percentage(remainingForPercent, normalizedLimit)
    : null;
  const remainingPercent = derived ?? requirePercent(allowance.remainingPercent);

  return {
    key: allowance.key,
    label: allowance.label,
    remaining,
    value,
    valueKind,
    limit: normalizedLimit,
    remainingPercent,
    unit: allowance.unit,
    resetsAt: validEpochMs(allowance.resetsAt),
  };
}

function normalizeAbsoluteValue(allowance) {
  const legacyRemaining = finiteNumber(allowance.remaining);
  const explicitValue = finiteNumber(allowance.value);
  // Negative absolutes are malformed, not zero capacity. Dropping them
  // prevents a bogus negative `used` value becoming a healthy snapshot.
  const normalizedLegacyRemaining = legacyRemaining === null || legacyRemaining < 0 ? null : legacyRemaining;
  const value = explicitValue === null || explicitValue < 0 ? normalizedLegacyRemaining : explicitValue;
  const valueKind = value === null ? null
    : allowance.valueKind === 'used' || allowance.valueKind === 'remaining'
      ? allowance.valueKind : 'remaining';
  return { remaining: normalizedLegacyRemaining, value, valueKind };
}

function remainingForPercentage(value, valueKind, limit, remaining) {
  if (valueKind === 'used' && value !== null && limit !== null) return Math.max(0, limit - value);
  return remaining;
}

function isProviderAllowanceStatus(value) {
  return ProviderAllowanceStatus.safeParse(value).success;
}

function hasDisplayIdentity(allowance) {
  return allowance && typeof allowance === 'object'
    && typeof allowance.key === 'string' && Boolean(allowance.key)
    && typeof allowance.label === 'string' && Boolean(allowance.label)
    && isUnit(allowance.unit);
}

// Status thresholds apply to the most depleted authoritative allowance.
export const ALLOWANCE_STATUS_THRESHOLDS = Object.freeze({ warning: 25, critical: 10 });

export function deriveStatus(remainingPercent) {
  if (remainingPercent <= 0) return 'exhausted';
  if (remainingPercent <= ALLOWANCE_STATUS_THRESHOLDS.critical) return 'critical';
  if (remainingPercent <= ALLOWANCE_STATUS_THRESHOLDS.warning) return 'warning';
  return 'available';
}

function isUnit(value) {
  return ['tokens', 'requests', 'credits', 'other'].includes(value);
}

function isSource(value) {
  return ['provider', 'observed-header', 'configured'].includes(value);
}

// Staleness is a freshness overlay: the flag marks last-known data as out
// of date while `status` keeps the underlying attention state, so a
// stale-critical provider still sorts and reads as critical.
export function withFreshness(snapshot, now) {
  return snapshot.staleAt !== null && snapshot.staleAt <= now && !snapshot.stale
    ? { ...snapshot, stale: true }
    : snapshot;
}

/**
 * Most-recently-used order: the most recently used provider sorts first,
 * never-used providers (`lastUsedAt: null`) sort last. Ties keep configured
 * order via a stable sort, so REST and websocket consumers share
 * deterministic ordering without exposing session details.
 */
export function prioritizeSnapshots(snapshots) {
  return [...snapshots].sort((left, right) => compareRecency(left?.lastUsedAt, right?.lastUsedAt));
}

function compareRecency(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return right - left;
}
