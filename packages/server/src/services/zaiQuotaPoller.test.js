import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// The observer and the HTTP client are mocked at their module boundaries so
// the poller's per-status policies are exercised against the real wiring.
const observer = vi.fn();
const fetchZaiQuotaLimit = vi.fn();
let fetchOutcome = { outcome: 'ok', payload: null };
let enabledProviders = [];

vi.mock('../database.js', () => ({
  modelProviders: {
    getEnabledForAllowances: () => enabledProviders,
  },
}));

vi.mock('./providerAllowanceServiceInstance.js', () => ({
  getProviderAllowanceObserver: () => observer,
}));
vi.mock('./zaiQuotaClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchZaiQuotaLimit,
  };
});

const {
  pollOnce,
  startZaiQuotaPoller,
  stopZaiQuotaPoller,
  zaiQuotaProviders,
  _resetZaiQuotaPollerStateForTests,
} = await import('./zaiQuotaPoller.js');
const { mapZaiQuota } = await import('../agents/adapters/zaiAllowanceMapper.js');

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'tests', 'fixtures', 'zai', 'quota-limit.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const zaiProvider = {
  id: 'zai-glm',
  name: 'GLM Coding Plan',
  kind: 'anthropic',
  baseUrl: 'https://api.z.ai/api/anthropic',
  authToken: 'plan-key-v1',
  enabled: true,
};
const rotatedProvider = { ...zaiProvider, authToken: 'plan-key-v2' };

function repositoryWith(providers) {
  return { getEnabledForAllowances: () => providers };
}

describe('zaiQuotaPoller', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = {
      PROVIDER_ALLOWANCES_ENABLED: process.env.PROVIDER_ALLOWANCES_ENABLED,
      PROVIDER_ALLOWANCES_ZAI: process.env.PROVIDER_ALLOWANCES_ZAI,
    };
    process.env.PROVIDER_ALLOWANCES_ENABLED = '1';
    process.env.PROVIDER_ALLOWANCES_ZAI = '1';
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    fetchZaiQuotaLimit.mockImplementation(() => Promise.resolve(fetchOutcome));
    fetchZaiQuotaLimit.mockClear();
    enabledProviders = [];
    observer.mockClear();
    _resetZaiQuotaPollerStateForTests();
  });

  afterEach(() => {
    stopZaiQuotaPoller();
    vi.useRealTimers();
    Object.assign(process.env, {
      PROVIDER_ALLOWANCES_ENABLED: originalEnv.PROVIDER_ALLOWANCES_ENABLED,
      PROVIDER_ALLOWANCES_ZAI: originalEnv.PROVIDER_ALLOWANCES_ZAI,
    });
  });

  it('polls GLM plan providers and observes mapped absolute allowances', async () => {
    await pollOnce({ clock: { now: () => 1_789_855_000_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(observer).toHaveBeenCalledExactlyOnceWith({
      ...mapZaiQuota(fixture.payload, { observedAt: 1_789_855_000_000 }),
      providerId: zaiProvider.id,
    });
  });

  it('bounds simultaneous provider requests', async () => {
    let active = 0;
    let peak = 0;
    const releases = [];
    fetchZaiQuotaLimit.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      releases.push(() => { active -= 1; resolve(fetchOutcome); });
    }));
    const providers = Array.from({ length: 5 }, (_, index) => ({ ...zaiProvider, id: `zai-${index}` }));
    const pending = pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith(providers) });
    await Promise.resolve();
    expect(peak).toBeLessThanOrEqual(3);
    while (releases.length) { releases.shift()(); await Promise.resolve(); }
    await pending;
  });

  it('stops polling a provider whose credential was rejected until the key is rotated', async () => {
    fetchOutcome = { outcome: 'http', status: 401, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).not.toHaveBeenCalled();

    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).not.toHaveBeenCalled(); // same bad key: skipped

    const providers = repositoryWith([rotatedProvider]);
    expect(zaiQuotaProviders(providers, { clock: { now: () => 1_000 } })).toEqual([rotatedProvider]);
  });

  it('honors retry-after on 429 and resumes after the backoff elapses', async () => {
    fetchOutcome = { outcome: 'http', status: 429, retryAfterMs: 60_000 };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    const repository = repositoryWith([zaiProvider]);
    expect(zaiQuotaProviders(repository, { clock: { now: () => 30_000 } })).toEqual([]);
    expect(zaiQuotaProviders(repository, { clock: { now: () => 61_000 } })).toEqual([zaiProvider]);
  });

  it('forgets a rejected credential once the provider is deleted, so a re-created provider with the same key gets a fresh chance', async () => {
    fetchOutcome = { outcome: 'http', status: 401, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(fetchZaiQuotaLimit).toHaveBeenCalledTimes(1);

    // The provider is deleted; the next tick prunes its auth-failure memory…
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([]) });

    // …so re-creating it with the very same key polls again instead of
    // staying skipped until a server restart.
    await pollOnce({ clock: { now: () => 3_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(fetchZaiQuotaLimit).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      ...mapZaiQuota(fixture.payload, { observedAt: 3_000 }),
      providerId: zaiProvider.id,
    });
  });

  it('drops a 429 backoff on the next tick after the provider is deleted', async () => {
    fetchOutcome = { outcome: 'http', status: 429, retryAfterMs: 600_000 };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    // Provider absent for one tick: backoff state must not outlive it.
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([]) });

    const repository = repositoryWith([zaiProvider]);
    expect(zaiQuotaProviders(repository, { clock: { now: () => 3_000 } })).toEqual([zaiProvider]);
  });

  it('keeps the last snapshot on server errors and network failures without crashing', async () => {
    fetchOutcome = { outcome: 'http', status: 500, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    fetchOutcome = { outcome: 'network' };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(observer).not.toHaveBeenCalled();
  });

  it('observes nothing when the payload has no usable rows', async () => {
    fetchOutcome = { outcome: 'ok', payload: { success: true, data: { limits: [] } } };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(observer).not.toHaveBeenCalled();
  });

  it('does not poll while the source gate is off', async () => {
    delete process.env.PROVIDER_ALLOWANCES_ZAI;
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(observer).not.toHaveBeenCalled();
  });

  it('polls immediately when started, without waiting for the interval', async () => {
    vi.useFakeTimers();
    enabledProviders = [zaiProvider];

    startZaiQuotaPoller();
    await vi.waitFor(() => expect(fetchZaiQuotaLimit).toHaveBeenCalledOnce());
  });
});
