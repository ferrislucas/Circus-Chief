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
    const enabled = providerRepository.getEnabledForAllowances?.() ?? [];
    // Failure and backoff memory must not outlive the provider it belongs
    // to — otherwise a deleted provider's entry (including its rejected
    // credential string) is retained until restart, and a re-created
    // provider with the same key stays wrongly skipped.
    pruneProviderState(enabled);
    await Promise.all(zaiQuotaCandidates(enabled, clock.now()).map(async (provider) => {
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
  const enabled = providerRepository.getEnabledForAllowances?.() ?? [];
  return zaiQuotaCandidates(enabled, clock.now());
}

function zaiQuotaCandidates(enabledProviders, now) {
  return enabledProviders
    .filter((provider) => provider.kind === 'anthropic'
      && isZaiQuotaHost(provider.baseUrl)
      && typeof provider.authToken === 'string' && provider.authToken.length > 0
      && authFailedProviders.get(provider.id) !== provider.authToken
      && (rateLimitedUntil.get(provider.id) ?? 0) <= now);
}

/**
 * Drop failure/backoff entries for provider ids that no longer exist among
 * the enabled providers, so per-provider state (including rejected
 * credential strings) never outlives its provider until a restart.
 */
function pruneProviderState(enabledProviders) {
  const enabledIds = new Set(enabledProviders.map((provider) => provider.id));
  for (const providerId of [...authFailedProviders.keys()]) {
    if (!enabledIds.has(providerId)) authFailedProviders.delete(providerId);
  }
  for (const providerId of [...rateLimitedUntil.keys()]) {
    if (!enabledIds.has(providerId)) rateLimitedUntil.delete(providerId);
  }
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
        // Bad key: stop polling this provider until the stored credential
        // changes. The last good snapshot persists and ages into `stale` on
        // its own freshness policy (2× the poll interval); the UI presents
        // it with its last-updated time — nothing resets it to unknown.
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
