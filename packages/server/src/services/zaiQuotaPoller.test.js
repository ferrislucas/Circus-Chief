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
  hashAuthToken,
  _authFailureHashForTests,
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
  beforeEach(() => {
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
  });

  it('polls GLM plan providers and observes mapped absolute allowances', async () => {
    await pollOnce({ clock: { now: () => 1_789_855_000_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(observer).toHaveBeenCalledExactlyOnceWith({
      ...mapZaiQuota(fixture.payload, { observedAt: 1_789_855_000_000 }),
      providerId: zaiProvider.id,
    });
  });

  it('polls openai-kind providers on z.ai hosts end-to-end through the allowance service', async () => {
    const { ProviderAllowanceService } = await import('./ProviderAllowanceService.js');
    const { WS_MESSAGE_TYPES } = await import('@circuschief/shared');
    const openaiZai = {
      id: 'zai-glm-openai',
      name: 'GLM Coding Plan (OpenAI)',
      kind: 'openai',
      baseUrl: 'https://api.z.ai/api/openai',
      authToken: 'plan-key-openai',
      enabled: true,
    };
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: repositoryWith([openaiZai]), broadcaster,
    });
    observer.mockImplementationOnce((candidate) => service.observe(candidate));

    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([openaiZai]) });

    expect(fetchZaiQuotaLimit).toHaveBeenCalledTimes(1);
    expect(service.getSnapshots().snapshots).toEqual([
      expect.objectContaining({ providerId: openaiZai.id, providerKind: 'openai', source: 'provider' }),
    ]);
    expect(broadcaster).toHaveBeenCalledWith(
      WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED,
      { snapshot: expect.objectContaining({ providerId: openaiZai.id }) },
    );
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
    // A rejection with no good snapshot yet observes one diagnostic unknown
    // so the indicator can report the reason.
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      providerId: zaiProvider.id,
      providerKind: 'anthropic',
      source: 'provider',
      status: 'unknown',
      updatedAt: 1_000,
      allowances: [],
      unavailableReason: expect.stringContaining('rejected'),
    });

    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1); // same bad key: skipped

    const providers = repositoryWith([rotatedProvider]);
    expect(zaiQuotaProviders(providers, { clock: { now: () => 1_000 } })).toEqual([rotatedProvider]);
  });

  it('surfaces the rejection reason through the allowance service snapshot', async () => {
    const { ProviderAllowanceService } = await import('./ProviderAllowanceService.js');
    const service = new ProviderAllowanceService({
      providerRepository: repositoryWith([zaiProvider]), broadcaster: vi.fn(),
    });
    observer.mockImplementationOnce((candidate) => service.observe(candidate));

    fetchOutcome = { outcome: 'http', status: 401, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });

    expect(service.getSnapshots().snapshots).toEqual([
      expect.objectContaining({
        providerId: zaiProvider.id,
        status: 'unknown',
        allowances: [],
        unavailableReason: expect.stringContaining('rejected'),
      }),
    ]);
  });

  it('keeps the last good snapshot when a later poll rejects the credential', async () => {
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);

    // A rejection never resets known data to unknown.
    fetchOutcome = { outcome: 'http', status: 401, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([rotatedProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);
    expect(_authFailureHashForTests(rotatedProvider.id)).toBe(hashAuthToken(rotatedProvider.authToken));
  });

  it('detects key rotation without retaining the raw credential', async () => {
    fetchOutcome = { outcome: 'http', status: 401, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1); // diagnostic unknown with the reason

    // The rejection is remembered as a hash, never as the credential string.
    expect(_authFailureHashForTests(zaiProvider.id)).toBe(hashAuthToken(zaiProvider.authToken));
    expect(_authFailureHashForTests(zaiProvider.id)).not.toBe(zaiProvider.authToken);

    // Same key stays skipped; a rotated key polls again.
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);
    await pollOnce({ clock: { now: () => 3_000 }, providerRepository: repositoryWith([rotatedProvider]) });
    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenLastCalledWith({
      ...mapZaiQuota(fixture.payload, { observedAt: 3_000 }),
      providerId: rotatedProvider.id,
    });
  });

  it('hashAuthToken is stable, distinct per input, and non-reversible', () => {
    expect(hashAuthToken('plan-key-v1')).toBe(hashAuthToken('plan-key-v1'));
    expect(hashAuthToken('plan-key-v1')).not.toBe(hashAuthToken('plan-key-v2'));
    const digest = hashAuthToken('plan-key-v1');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('plan-key-v1');
  });

  it('keeps polling after an unclassified envelope failure with the same credential', async () => {
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);

    // An unclassified provider failure must not look like credential rejection.
    fetchOutcome = { outcome: 'http', status: 500, retryAfterMs: null };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1); // previous snapshot survives, no diagnostic unknown
    expect(_authFailureHashForTests(zaiProvider.id)).toBeNull();
    expect(zaiQuotaProviders(repositoryWith([zaiProvider]), { clock: { now: () => 2_000 } })).toEqual([zaiProvider]);

    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 3_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(2);
  });

  it('recovers from an unclassified error envelope without credential rotation end-to-end', async () => {
    // Joins the real quota-client classifier to the poller policy with only
    // the HTTP transport mocked: a code-less success:false envelope must not
    // disable polling for the unchanged credential.
    const actualClient = await vi.importActual('./zaiQuotaClient.js');
    const httpFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(fixture.payload),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: false }),
      });
    fetchZaiQuotaLimit.mockImplementation((args) => actualClient.fetchZaiQuotaLimit({ ...args, fetchImpl: httpFetch }));

    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);

    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1); // snapshot survives, no rejection diagnostic
    expect(_authFailureHashForTests(zaiProvider.id)).toBeNull();

    httpFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(fixture.payload),
    });
    await pollOnce({ clock: { now: () => 3_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(2); // same key polls again, no rotation
    expect(observer).toHaveBeenLastCalledWith({
      ...mapZaiQuota(fixture.payload, { observedAt: 3_000 }),
      providerId: zaiProvider.id,
    });
  });

  it('honors a one-hour Retry-After from a 200/429 envelope until expiry', async () => {
    // Real client classification with mocked HTTP transport: the envelope 429
    // must back off for the requested hour, not the default five minutes.
    const actualClient = await vi.importActual('./zaiQuotaClient.js');
    const httpFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(fixture.payload),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'retry-after' ? '3600' : null) },
        json: () => Promise.resolve({ code: 429, msg: 'rate limited', success: false }),
      });
    fetchZaiQuotaLimit.mockImplementation((args) => actualClient.fetchZaiQuotaLimit({ ...args, fetchImpl: httpFetch }));

    await pollOnce({ clock: { now: () => 1_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1);

    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(observer).toHaveBeenCalledTimes(1); // throttled: good data preserved
    expect(_authFailureHashForTests(zaiProvider.id)).toBeNull();

    const repository = repositoryWith([zaiProvider]);
    expect(zaiQuotaProviders(repository, { clock: { now: () => 302_000 } })).toEqual([]); // past the 5-minute default
    expect(zaiQuotaProviders(repository, { clock: { now: () => 3_601_999 } })).toEqual([]);
    expect(zaiQuotaProviders(repository, { clock: { now: () => 3_602_000 } })).toEqual([zaiProvider]);
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
    expect(observer).toHaveBeenCalledTimes(1); // diagnostic unknown with the reason

    // The provider is deleted; the next tick prunes its auth-failure memory…
    fetchOutcome = { outcome: 'ok', payload: fixture.payload };
    await pollOnce({ clock: { now: () => 2_000 }, providerRepository: repositoryWith([]) });

    // …so re-creating it with the very same key polls again instead of
    // staying skipped until a server restart.
    await pollOnce({ clock: { now: () => 3_000 }, providerRepository: repositoryWith([zaiProvider]) });
    expect(fetchZaiQuotaLimit).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenLastCalledWith({
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

  it('polls immediately when started, without waiting for the interval', async () => {
    vi.useFakeTimers();
    enabledProviders = [zaiProvider];

    startZaiQuotaPoller();
    await vi.waitFor(() => expect(fetchZaiQuotaLimit).toHaveBeenCalledOnce());
  });
});
