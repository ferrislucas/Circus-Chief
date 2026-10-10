import { DEFAULT_MUSE_MODEL } from '@circuschief/shared';
import { getStreamStaleAfterMs } from '../../config/providerAllowances.js';
import { clampRemainingPercent, finiteNumber } from '../../services/allowanceNumbers.js';
import { validEpochMs } from '../../services/allowanceTime.js';

export { DEFAULT_MUSE_MODEL as MUSE_PROBE_DEFAULT_MODEL };

/**
 * Map a validated MSP `SubscriptionUsage` payload (`usage/changed` params or
 * `usage/read`'s `usage` member) into an allowance candidate for the provider
 * allowance service.
 *
 * The wire reports consumption percent per window (`usedPercent` may exceed
 * 100 when over quota); the snapshot contract reports remaining percent, so
 * `remainingPercent = clamp(100 - usedPercent)`. The `tier` id is dropped at
 * this boundary and never persisted, logged, or broadcast — mirroring how
 * the Claude mapper drops uuid/session_id. Absence is truthful (`usage`
 * omitted, never null), so a payload with no usable window maps to null
 * rather than to a fabricated zero; a present-but-malformed window poisons
 * the whole candidate for the same reason.
 */

const WINDOW_ALLOWANCE = Object.freeze({
  window: { key: 'window', label: '5-hour window' },
  weekly: { key: 'weekly', label: 'Weekly window' },
});

// An absent window yields undefined (the surviving allowance still reports);
// a present-but-malformed window yields null (the candidate is unusable).
function mapWindow(name, entry) {
  if (entry === undefined) return undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const usedPercent = finiteNumber(entry.usedPercent);
  // A negative or non-numeric consumption percent is malformed input, not
  // exhaustion: it poisons the candidate instead of fabricating a value.
  if (usedPercent === null || usedPercent < 0) return null;
  // A present-but-invalid reset is malformed, not a missing reset: it
  // poisons the candidate. An absent reset keeps the allowance with a null
  // timestamp.
  if (entry.resetsAtMs !== undefined && validEpochMs(entry.resetsAtMs) === null) return null;
  return {
    key: WINDOW_ALLOWANCE[name].key,
    label: WINDOW_ALLOWANCE[name].label,
    remaining: null,
    limit: null,
    remainingPercent: clampRemainingPercent(100 - usedPercent),
    unit: 'other', // the wire carries a consumption percentage with no denomination (FRD §4 FR-3)
    resetsAt: validEpochMs(entry.resetsAtMs),
  };
}

export function mapMuseUsageChanged(usage, { observedAt = Date.now(), streamStaleMs = getStreamStaleAfterMs() } = {}) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;

  const windows = ['window', 'weekly'].map((name) => mapWindow(name, usage[name]));
  if (windows.some((window) => window === null)) return null;
  const allowances = windows.filter(Boolean);
  if (allowances.length === 0) return null;

  return {
    providerKind: 'meta',
    source: 'provider',
    updatedAt: validEpochMs(usage.observedAtMs) ?? observedAt,
    staleAfterMs: streamStaleMs,
    allowances,
  };
}
