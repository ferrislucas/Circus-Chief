import { normalizeEpochMs } from '../../services/allowanceTime.js';

/**
 * Map a z.ai GLM Coding Plan quota payload into an allowance candidate.
 *
 * z.ai is the only subscription source with absolute numbers (`currentValue`
 * used of `usage` limit), which feed the detail view's "X of Y tokens"
 * presentation (AC 19). Rows are reduced to normalized fields before leaving
 * this module: account identifiers (`usageDetails` breakdowns) and TIME_LIMIT
 * rows (MCP tool-call budgets) are not forwarded (FR-8).
 */

// unit 3 = 5-hour window, unit 6 = weekly (newer plans). Unknown units are
// ignored rather than guessed at.
const UNITS = new Map([
  [3, { key: 'five_hour', label: '5-hour token window' }],
  [6, { key: 'weekly', label: 'Weekly token window' }],
]);

export const ZAI_POLL_STALE_MS = 10 * 60_000; // 2 × the 5-minute poll interval

export function mapZaiQuota(payload, { observedAt = Date.now(), staleAfterMs = ZAI_POLL_STALE_MS } = {}) {
  const limits = payload?.data?.limits;
  if (!Array.isArray(limits)) return null;

  const allowances = [];
  for (const limit of limits) {
    if (limit?.type !== 'TOKENS_LIMIT') continue; // TIME_LIMIT rows filtered
    const window = UNITS.get(limit.unit);
    if (!window) continue;

    const limitValue = finiteNumber(limit.usage);
    const usedValue = finiteNumber(limit.currentValue);
    const remaining = limitValue !== null && usedValue !== null
      ? Math.max(0, limitValue - usedValue)
      : null;
    // Tolerated future shape: percentage without absolutes still feeds the
    // indicator through the percentage-only normalization path; the service
    // derives its percentage from absolutes when they exist (§4.1).
    const fallbackPercent = remaining === null ? clampPercent(100 - limit.percentage) : null;
    if (remaining === null && fallbackPercent === null) continue; // no usable measurement

    allowances.push({
      key: window.key,
      label: window.label,
      remaining,
      limit: limitValue,
      remainingPercent: fallbackPercent,
      unit: 'tokens',
      resetsAt: normalizeEpochMs(limit.nextResetTime), // unix ms on the wire
    });
  }
  if (allowances.length === 0) return null;

  return {
    providerKind: 'anthropic',
    source: 'provider',
    updatedAt: observedAt,
    staleAfterMs,
    allowances,
  };
}

export function clampPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
