import { modelProviders } from '../database.js';
import { isZaiAllowanceSourceEnabled } from '../config/providerAllowances.js';
import { getProviderAllowanceObserver } from './providerAllowanceServiceInstance.js';
import { fetchZaiQuotaLimit, isZaiQuotaHost } from './zaiQuotaClient.js';
import { mapZaiQuota } from '../agents/adapters/zaiAllowanceMapper.js';

/**
 * Polls the z.ai GLM Coding Plan quota endpoint for every enabled
 * anthropic-kind provider whose baseUrl is a GLM plan host, and feeds the
 * results to the provider allowance observer.
 *
 * The 5-minute cadence is aligned with z.ai's official plugin cache so the
 * poller never generates request pressure beyond the provider's own tooling.
 * Failure policy (FR-7): a 401/403 stops polling that provider (bad key — no
 * retry loop), 429 honors retry-after, 5xx/network errors keep the last
 * snapshot (staleness policy marks it stale), and nothing ever throws upward.
 */

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

// In-memory state; reset on server restart by design.
const authFailedProviders = new Map(); // providerId → authToken that failed
const rateLimitedUntil = new Map(); // providerId → epoch ms to resume polling

let pollTimer = null;
let pollInFlight = false;

export function startZaiQuotaPoller({ intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollOnce().catch(() => { /* never throws (FR-7) */ });
  }, intervalMs);
  pollTimer.unref?.();
  pollOnce().catch(() => { /* never throws (FR-7) */ });
}

export function stopZaiQuotaPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function pollOnce({ clock = Date, providerRepository = modelProviders } = {}) {
  if (!isZaiQuotaPollerEnabled() || pollInFlight) return;
  pollInFlight = true;
  try {
    const observer = getProviderAllowanceObserver();
    if (!observer) return;
    await Promise.all(zaiQuotaProviders(providerRepository, { clock }).map(async (provider) => {
      await pollProvider(provider, { observer, clock });
    }));
  } finally {
    pollInFlight = false;
  }
}

function isZaiQuotaPollerEnabled() {
  return isZaiAllowanceSourceEnabled();
}

/**
 * Enabled anthropic-kind providers on a GLM plan host with stored
 * credentials. The poll set is recomputed every tick so provider edits and
 * enable/disable are honored without a restart. Providers whose stored key
 * was rejected keep being skipped until the key is rotated; providers under a
 * 429 backoff are skipped until retry-after elapses.
 */
export function zaiQuotaProviders(providerRepository = modelProviders, { clock = Date } = {}) {
  const now = clock.now();
  return (providerRepository.getEnabledForAllowances?.() ?? [])
    .filter((provider) => provider.kind === 'anthropic'
      && isZaiQuotaHost(provider.baseUrl)
      && typeof provider.authToken === 'string' && provider.authToken.length > 0
      && authFailedProviders.get(provider.id) !== provider.authToken
      && (rateLimitedUntil.get(provider.id) ?? 0) <= now);
}

async function pollProvider(provider, { observer, clock }) {
  const startedAt = clock.now();
  const result = await fetchZaiQuotaLimit({
    baseUrl: provider.baseUrl,
    authToken: provider.authToken,
  });
  const durationMs = clock.now() - startedAt;
  const entry = { providerId: provider.id, providerKind: provider.kind, source: 'zai-quota-poll', durationMs };

  if (result.outcome !== 'ok') {
    if (result.outcome === 'http') {
      if (result.status === 401 || result.status === 403) {
        // Bad key: stop polling this provider until the credential changes;
        // the snapshot returns to unknown with its explanation.
        authFailedProviders.set(provider.id, provider.authToken);
      } else if (result.status === 429) {
        rateLimitedUntil.set(provider.id, clock.now() + (result.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS));
      }
    }
    console.log('[ZaiQuotaPoller]', JSON.stringify({
      ...entry,
      outcome: result.outcome === 'http' ? `http-${result.status}` : result.outcome,
    }));
    return;
  }

  const candidate = mapZaiQuota(result.payload, { observedAt: clock.now() });
  if (!candidate) {
    console.log('[ZaiQuotaPoller]', JSON.stringify({ ...entry, outcome: 'no-data' }));
    return;
  }
  try {
    observer({ ...candidate, providerId: provider.id });
    console.log('[ZaiQuotaPoller]', JSON.stringify({ ...entry, outcome: 'ok' }));
  } catch {
    // Allowance telemetry is non-critical (FR-7).
  }
}

/**
 * Test-only: reset per-provider failure memory.
 * @private
 */
export function _resetZaiQuotaPollerStateForTests() {
  authFailedProviders.clear();
  rateLimitedUntil.clear();
}
