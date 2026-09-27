/**
 * Shared time normalization for allowance sources. Subscription sources
 * report reset timestamps in mixed native units (Claude SDK and Codex report
 * unix seconds; z.ai reports unix milliseconds), while the snapshot contract
 * and web components use numeric epoch milliseconds everywhere.
 */

// Values below 1e11 cannot be a millisecond epoch in a plausible era
// (1e11 ms ≈ March 1973), so they are treated as seconds. Everything at or
// above is passed through as milliseconds. Non-numeric and non-positive
// values are untrusted input and normalize to null.
export function normalizeEpochMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const epochMs = value < 1e11 ? value * 1000 : value;
  return Number.isFinite(new Date(epochMs).getTime()) ? epochMs : null;
}

export function validEpochMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    && Number.isFinite(new Date(value).getTime()) ? value : null;
}
