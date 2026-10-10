import { describe, expect, it, vi } from 'vitest';
import { buildZaiQuotaUrl, fetchZaiQuotaLimit, isZaiQuotaHost } from './zaiQuotaClient.js';

describe('isZaiQuotaHost', () => {
  it.each([
    ['https://api.z.ai', true],
    ['https://api.z.ai/api/anthropic', true],
    ['https://open.bigmodel.cn/api/paas/v4', true],
    ['https://api.openai.com/v1', false],
    ['https://evil.example.com/api.z.ai', false],
    ['', false],
    [null, false],
    ['not-a-url', false],
  ])('detects GLM plan host %s', (baseUrl, expected) => {
    expect(isZaiQuotaHost(baseUrl)).toBe(expected);
  });

  it.each([
    ['http://api.z.ai', false],
    ['http://open.bigmodel.cn', false],
    ['https://api.z.ai.evil.example', false],
    ['https://key@api.z.ai', false],
    ['https://api.z.ai:8443', false],
    ['https://api.z.ai', true],
    ['https://open.bigmodel.cn:443/api/paas/v4', true],
  ])('requires a secure approved origin for %s', (baseUrl, expected) => {
    expect(isZaiQuotaHost(baseUrl)).toBe(expected);
  });
});

describe('buildZaiQuotaUrl', () => {
  it('derives the quota endpoint from the provider base URL origin', () => {
    expect(buildZaiQuotaUrl('https://api.z.ai/api/anthropic')).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    expect(buildZaiQuotaUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  });
});

describe('fetchZaiQuotaLimit', () => {
  it('honors a date-form retry-after on 429 via an HTTP-date fallback', async () => {
    const retryAt = Date.now() + 60_000;
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: false,
      status: 429,
      headers: { get: (name) => (name === 'retry-after' ? new Date(retryAt).toUTCString() : null) },
    }));

    const result = await fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'secret-key', fetchImpl });

    expect(result.outcome).toBe('http');
    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('keeps numeric retry-after seconds working alongside the date fallback', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: false,
      status: 429,
      headers: { get: (name) => (name === 'retry-after' ? '5' : null) },
    }));

    const result = await fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'secret-key', fetchImpl });

    expect(result).toEqual({ outcome: 'http', status: 429, retryAfterMs: 5_000 });
  });
  it('classifies a 200 error envelope as the HTTP failure it reports', async () => {
    // z.ai answers rejected credentials with HTTP 200 plus
    // {"code":401,"msg":"token expired or incorrect","success":false}.
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 401, msg: 'token expired or incorrect', success: false }),
    }));

    const result = await fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'stale-key', fetchImpl });

    expect(result).toEqual({ outcome: 'http', status: 401, retryAfterMs: null });
  });

  it('classifies a success:false envelope without a code as a 401', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false }),
    }));

    const result = await fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'stale-key', fetchImpl });

    expect(result).toEqual({ outcome: 'http', status: 401, retryAfterMs: null });
  });

  it('passes a success envelope through as ok', async () => {
    const payload = { success: true, data: { limits: [] } };
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    }));

    const result = await fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'plan-key', fetchImpl });

    expect(result).toEqual({ outcome: 'ok', payload });
  });

  it('aborts a stalled request at timeout without exposing its authorization value', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }));
    const result = fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'secret-key', timeoutMs: 10, fetchImpl });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toEqual({ outcome: 'network' });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('keeps the abort deadline active while a successful response body stalls', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, options) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))),
    }));
    const result = fetchZaiQuotaLimit({ baseUrl: 'https://api.z.ai', authToken: 'secret-key', timeoutMs: 10, fetchImpl });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toEqual({ outcome: 'network' });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    vi.useRealTimers();
  });
});
