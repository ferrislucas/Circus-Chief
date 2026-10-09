export function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Trust-boundary gate: accepts only a finite percentage already inside 0–100
 * and rejects anything else as malformed. Used where adapter-supplied values
 * are normalized untrusted input; a violation there means a broken adapter,
 * not an exhausted provider. Contrast with `clampRemainingPercent`, which
 * clamps conversion-boundary results instead of rejecting them.
 */
export function requirePercent(value) {
  return finiteNumber(value) !== null && value >= 0 && value <= 100 ? value : null;
}

/**
 * Conversion-boundary clamp for utilization-derived percentages: a provider
 * reporting consumption outside 0–100 still yields a usable remaining value
 * on the exhausted/over-limit edge (FRD AC-14 — derive 100 − utilization and
 * clamp). Finite input clamps into 0–100; non-finite input carries no numeric
 * meaning and yields null. Contrast with `requirePercent`, which rejects
 * out-of-range input outright.
 */
export function clampRemainingPercent(value) {
  return finiteNumber(value) === null ? null : Math.min(100, Math.max(0, value));
}

export function percentage(remaining, limit) {
  return Math.min(100, Math.max(0, (remaining / limit) * 100));
}
