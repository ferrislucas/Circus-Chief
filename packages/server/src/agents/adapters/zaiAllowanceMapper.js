import { normalizeEpochMs } from '../../services/allowanceTime.js';
import { clampRemainingPercent, finiteNumber } from '../../services/allowanceNumbers.js';

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
    const allowance = mapTokenLimit(limit);
    if (allowance) allowances.push(allowance);
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

// Validation is deliberately explicit here: each provider field is untrusted.
// eslint-disable-next-line complexity
function mapTokenLimit(limit) {
  if (limit?.type !== 'TOKENS_LIMIT') return null; // TIME_LIMIT rows filtered
  const window = UNITS.get(limit.unit);
  if (!window) return null;

  const limitValue = nonNegativeFiniteNumber(limit.usage);
  const usedValue = nonNegativeFiniteNumber(limit.currentValue);
  const hasAbsoluteInput = limit.currentValue !== undefined || limit.usage !== undefined;
  if (hasAbsoluteInput && (limitValue === null || usedValue === null || limitValue === 0 || usedValue > limitValue)) return null;
  // Tolerated future shape: percentage without absolutes still feeds the
  // indicator through the percentage-only normalization path; the service
  // derives its percentage from absolutes when they exist (§4.1).
  const percentage = finiteNumber(limit.percentage);
  const fallbackPercent = usedValue === null || limitValue === null ? percentage === null ? null : clampRemainingPercent(100 - percentage) : null;
  if (usedValue !== null && percentage !== null && Math.abs((usedValue / limitValue) * 100 - percentage) > 0.001) return null;
  if (usedValue === null && fallbackPercent === null) return null;

  return {
    key: window.key,
    label: window.label,
    remaining: null,
    value: usedValue,
    valueKind: usedValue === null ? null : 'used',
    limit: limitValue,
    remainingPercent: fallbackPercent,
    unit: 'tokens',
    resetsAt: normalizeEpochMs(limit.nextResetTime), // unix ms on the wire
  };
}

function nonNegativeFiniteNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}
