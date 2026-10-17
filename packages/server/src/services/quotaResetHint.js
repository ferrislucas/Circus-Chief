/**
 * Pure translator between allowance telemetry and the scheduler.
 *
 * Knows neither system: it consumes a normalized allowance snapshot and
 * answers "when does the exhausted quota reset?" — or null when there is
 * no usable answer. Deterministic: same snapshot + now → same hint; the
 * module never reads the clock itself (`now` is always a parameter).
 */

// A window participates only when its remaining percentage is at or below
// this threshold. Status-only sources report `remainingPercent: null` and
// therefore never count as exhausted.
export const EXHAUSTED_REMAINING_THRESHOLD = 0;

// Wake this far after the provider's reset so a retry never lands exactly
// on the provider boundary (absorbed clock skew included).
export const RETRY_BUFFER_MS = 3 * 60_000;

// Scheduler clamp for quota-derived waits: never wake sooner than this,
// never park longer than this in a single hop (distant resets are reached
// in bounded hops that re-hint at each wake).
export const MIN_QUOTA_WAIT_MS = 2 * 60_000;
export const MAX_QUOTA_WAIT_MS = 24 * 60 * 60_000;

function isExhausted(allowance) {
  return typeof allowance?.remainingPercent === 'number'
    && Number.isFinite(allowance.remainingPercent)
    && allowance.remainingPercent <= EXHAUSTED_REMAINING_THRESHOLD;
}

function validFutureReset(allowance, now) {
  return typeof allowance?.resetsAt === 'number'
    && Number.isFinite(allowance.resetsAt)
    && allowance.resetsAt > now
    ? allowance.resetsAt
    : null;
}

// Fallback freshness window for snapshots that carry no staleness
// metadata (`staleAt: null`). Sources that always attach `staleAfterMs`
// (stream mappers, ZAI poller) refresh well within this window; sources
// that cannot (e.g. the OpenAI extractor when no reset is known, or
// status-only frames) leave `staleAt` null, so age is judged from
// `updatedAt` instead. 2x the default 15-minute stream window: hours-old
// telemetry is definitively cold, while live telemetry is unaffected.
export const STALE_FALLBACK_TTL_MS = 30 * 60_000;

function isStale(snapshot, now) {
  // A stale snapshot describes the past, not the provider clock: ignore it
  // even when it names an exhausted window with a future reset.
  if (typeof snapshot.staleAt === 'number' && Number.isFinite(snapshot.staleAt)) {
    return snapshot.staleAt <= now;
  }
  // No staleness metadata: fall back to observation age. A missing or
  // non-numeric `updatedAt` cannot prove freshness, so it fails closed.
  return typeof snapshot.updatedAt !== 'number'
    || !Number.isFinite(snapshot.updatedAt)
    || now - snapshot.updatedAt > STALE_FALLBACK_TTL_MS;
}

function latestExhaustedReset(allowances, now) {
  let latest = null;
  for (const allowance of allowances) {
    if (!isExhausted(allowance)) continue;
    const resetsAt = validFutureReset(allowance, now);
    // Every exhausted window must have reset before a retry can succeed,
    // so the latest reset wins.
    if (resetsAt !== null && (latest === null || resetsAt > latest)) latest = resetsAt;
  }
  return latest;
}

/**
 * Resolve the quota-reset hint for a normalized allowance snapshot.
 * @param {object|null} snapshot - Stored snapshot shape
 *   `{ allowances: [{ remainingPercent, resetsAt }], staleAt, updatedAt }`.
 *   When `staleAt` carries no finite timestamp, `updatedAt` older than
 *   `STALE_FALLBACK_TTL_MS` (or missing) counts as stale.
 * @param {number} now - Epoch ms (caller-supplied clock)
 * @returns {{ resetsAt: number } | null} Max valid future `resetsAt` across
 *   exhausted windows, or null when there is nothing actionable. A stale or
 *   past reset is "no hint" — never "fire immediately".
 */
export function resolveQuotaResetHint(snapshot, now) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!Array.isArray(snapshot.allowances)) return null;
  if (isStale(snapshot, now)) return null;
  const latest = latestExhaustedReset(snapshot.allowances, now);
  return latest === null ? null : { resetsAt: latest };
}
