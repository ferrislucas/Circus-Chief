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
});
