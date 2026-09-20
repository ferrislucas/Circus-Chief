import { describe, expect, it } from 'vitest';
import { buildZaiQuotaUrl, isZaiQuotaHost } from './zaiQuotaClient.js';

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
});

describe('buildZaiQuotaUrl', () => {
  it('derives the quota endpoint from the provider base URL origin', () => {
    expect(buildZaiQuotaUrl('https://api.z.ai/api/anthropic')).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    expect(buildZaiQuotaUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  });
});
