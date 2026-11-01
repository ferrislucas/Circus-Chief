import { clampRemainingPercent, finiteNumber, percentage } from '../../services/allowanceNumbers.js';
import { normalizeEpochMs } from '../../services/allowanceTime.js';
import { getStreamStaleAfterMs } from '../../config/providerAllowances.js';

const BILLING_METHOD = '_x.ai/billing';
const BILLING_TIMEOUT_MS = 3000;

/**
 * Ask the already-authenticated Grok child for `_x.ai/billing`.
 * Unknown methods, timeouts, and unrecognized payloads are ignored.
 * This does not read `~/.grok/auth.json` and does not spend a prompt.
 *
 * @param {Object} client
 * @param {Object} opts
 */
export async function observeGrokBilling(client, {
  observer,
  providerId,
  clock = Date,
  timeoutMs = BILLING_TIMEOUT_MS,
  staleAfterMs = getStreamStaleAfterMs(),
} = {}) {
  if (typeof observer !== 'function' || !providerId || client?.closed || !client?.child?.stdin) return;
  let payload;
  try {
    payload = await client.request(BILLING_METHOD, {}, timeoutMs);
  } catch {
    return;
  }
  const candidate = mapGrokBilling(payload, { observedAt: clock.now(), staleAfterMs });
  if (!candidate) return;
  try {
    observer({ ...candidate, providerId });
  } catch {
    /* allowance telemetry must not fail the turn */
  }
}

/**
 * Map a published `_x.ai/billing` payload into an allowance candidate.
 * Any other shape returns null so the indicator stays unknown.
 *
 * @param {Object} payload
 * @param {{ observedAt?: number, staleAfterMs?: number }} [opts]
 * @returns {Object|null}
 */
export function mapGrokBilling(payload, { observedAt = Date.now(), staleAfterMs } = {}) {
  const allowance = allowanceFromAmounts(payload) || allowanceFromPercent(payload);
  if (!allowance) return null;
  return {
    providerKind: 'xai',
    source: 'provider',
    updatedAt: observedAt,
    staleAfterMs,
    status: null,
    allowances: [allowance],
  };
}

function allowanceFromAmounts(payload) {
  const usage = payload?.usage;
  const used = numberVal(usage?.includedUsed) ?? numberVal(usage?.totalUsed);
  const limit = numberVal(payload?.monthlyLimit);
  if (used === null || limit === null || limit <= 0 || used < 0) return null;
  const remaining = Math.max(0, limit - used);
  return {
    key: 'included',
    label: 'Included usage',
    remaining,
    limit,
    remainingPercent: percentage(remaining, limit),
    unit: 'credits',
    resetsAt: periodEnd(payload),
  };
}

function allowanceFromPercent(payload) {
  const raw = finiteNumber(payload?.config?.creditUsagePercent ?? payload?.creditUsagePercent);
  if (raw === null) return null;
  return {
    key: 'included',
    label: 'Included usage',
    remaining: null,
    limit: null,
    remainingPercent: clampRemainingPercent(100 - raw),
    unit: 'other',
    resetsAt: periodEnd(payload),
  };
}

function numberVal(node) {
  if (typeof node === 'number') return finiteNumber(node);
  return finiteNumber(node?.val);
}

function periodEnd(payload) {
  const raw = payload?.config?.currentPeriod?.end
    ?? payload?.config?.billingPeriodEnd
    ?? payload?.billingCycle?.billingPeriodEnd;
  if (typeof raw === 'number') return normalizeEpochMs(raw);
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
