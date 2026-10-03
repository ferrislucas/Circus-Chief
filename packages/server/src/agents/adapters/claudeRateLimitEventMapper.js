import { normalizeEpochMs } from '../../services/allowanceTime.js';
import { clampRemainingPercent, finiteNumber } from '../../services/allowanceNumbers.js';

/**
 * Map an SDK `rate_limit_event`'s `rate_limit_info` payload into an
 * allowance candidate for the provider allowance service.
 *
 * Claude subscription sources report utilization percent only — absolute
 * token counts do not exist on the wire (remaining = 100 − utilization, per
 * FRD AC 14; the server clamps and derives status). This boundary emits only
 * normalized measurements: `uuid`, `session_id`, overage billing fields, and
 * every other raw event attribute never leave this module.
 *
 * The `overage` rate-limit family (extra-usage billing) is deliberately
 * deferred — see the implementation plan's deferred table.
 */

const WINDOW_LABELS = Object.freeze({
  five_hour: '5-hour window',
  seven_day: 'Weekly window',
  seven_day_opus: 'Weekly Opus window',
  seven_day_sonnet: 'Weekly Sonnet window',
});

// Provider-native status → contract status. Consumed by the service only when
// the event carries no utilization percentage (AC 15); percentages always win.
const STATUS_HINTS = Object.freeze({
  rejected: 'exhausted',
  allowed_warning: 'warning',
  allowed: 'available',
});

export const CLAUDE_STREAM_STALE_MS = 15 * 60_000;

export function mapClaudeRateLimitEvent(info, { observedAt = Date.now(), streamStaleMs = CLAUDE_STREAM_STALE_MS } = {}) {
  if (!info || typeof info !== 'object') return null;

  const rateLimitType = typeof info.rateLimitType === 'string' ? info.rateLimitType : 'five_hour';
  if (!(rateLimitType in WINDOW_LABELS)) return null;

  const utilization = finiteNumber(info.utilization);
  const statusHint = STATUS_HINTS[info.status] ?? null;
  if (utilization === null && statusHint === null) return null;

  return {
    providerKind: 'anthropic',
    source: 'provider',
    updatedAt: observedAt,
    staleAfterMs: streamStaleMs,
    status: statusHint,
    allowances: [{
      key: rateLimitType,
      label: WINDOW_LABELS[rateLimitType],
      remaining: null,
      limit: null,
      remainingPercent: utilization === null ? null : clampRemainingPercent(100 - utilization),
      unit: 'tokens',
      resetsAt: normalizeEpochMs(info.resetsAt),
    }],
  };
}
