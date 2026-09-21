import { normalizeEpochMs } from '../../services/allowanceTime.js';
import { clampPercent, finiteNumber } from '../../services/allowanceNumbers.js';

/**
 * Map a Codex `RateLimitSnapshot` (delivered on `token_count` rollout events
 * under ChatGPT-plan auth) into an allowance candidate for the provider
 * allowance service.
 *
 * Codex subscription sources report `used_percent` only — absolute token
 * counts do not exist on the wire. Percentages arrive consumed, so they are
 * converted to remaining here (FRD AC 14) and clamped; `plan_type` and
 * `credits` are account/billing metadata that deliberately stays server-side.
 */

const WINDOWS = [
  ['primary', 'five_hour', '5-hour window'],
  ['secondary', 'weekly', 'Weekly window'],
];

export function mapCodexRateLimits(rateLimits, { observedAt = Date.now(), streamStaleMs = 15 * 60_000 } = {}) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;

  const allowances = [];
  for (const [field, key, label] of WINDOWS) {
    const window = rateLimits[field];
    const used = finiteNumber(window?.used_percent);
    if (used === null) continue;
    allowances.push({
      key,
      label,
      remaining: null,
      limit: null,
      remainingPercent: clampPercent(100 - used),
      unit: 'tokens',
      resetsAt: normalizeEpochMs(window.resets_at), // unix seconds on the wire
    });
  }
  if (allowances.length === 0) return null;

  return {
    providerKind: 'openai',
    source: 'provider',
    updatedAt: observedAt,
    staleAfterMs: streamStaleMs,
    allowances,
  };
}
