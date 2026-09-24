import { normalizeEpochMs } from '../../services/allowanceTime.js';
import { clampRemainingPercent, finiteNumber } from '../../services/allowanceNumbers.js';

/**
 * Map a Codex `RateLimitSnapshot` (delivered on `token_count` rollout events
 * and on the app-server `account/rateLimits/read` RPC under ChatGPT-plan
 * auth) into an allowance candidate for the provider allowance service.
 *
 * Codex subscription sources report utilization only — absolute token counts
 * do not exist on the wire. Percentages arrive consumed, so they are
 * converted to remaining here (FRD AC 14) and clamped; `planType`/`plan_type`
 * and `credits` are account/billing metadata that deliberately stays
 * server-side. Both wire spellings are accepted: rollout events use
 * snake_case (`used_percent`, `resets_at`) while the app-server RPC reports
 * camelCase (`usedPercent`, `resetsAt`).
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
    const used = finiteNumber(window?.used_percent ?? window?.usedPercent);
    if (used === null) continue;
    allowances.push({
      key,
      label,
      remaining: null,
      limit: null,
      remainingPercent: clampRemainingPercent(100 - used),
      unit: 'tokens',
      resetsAt: normalizeEpochMs(window.resets_at ?? window.resetsAt), // unix seconds on the wire
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
