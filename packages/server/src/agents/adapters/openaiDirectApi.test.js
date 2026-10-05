import { describe, expect, it, vi } from 'vitest';
import { createOpenAIStream, observeOpenAIAllowance } from './openaiDirectApi.js';

const HEADERS = {
  'x-ratelimit-limit-requests': '100',
  'x-ratelimit-remaining-requests': '75',
  'x-ratelimit-reset-requests': '12s',
  'x-ratelimit-limit-tokens': '100000',
  'x-ratelimit-remaining-tokens': '75000',
  'x-ratelimit-reset-tokens': '2m0s',
};

describe('observeOpenAIAllowance', () => {
  it('observes header allowances with no opt-in gate', () => {
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      providerId: 'openai-production',
      source: 'observed-header',
    }));
  });

  it('stays inert without an observer or providerId', () => {
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: null, allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });
    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: null, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).not.toHaveBeenCalled();
  });

  it('observes while still returning the stream', async () => {
    const observer = vi.fn();
    const stream = [{ choices: [{ delta: { content: 'hi' } }] }];
    // Mirrors the real SDK shape: the create() result is awaitable and
    // carries withResponse() for header access.
    const pending = Object.assign(Promise.resolve(stream), {
      withResponse: async () => ({ data: stream, response: { headers: HEADERS } }),
    });
    const client = { chat: { completions: { create: vi.fn(() => pending) } } };

    const result = await createOpenAIStream({
      client,
      request: { model: 'gpt-4o-mini', messages: [], stream: true },
      requestOptions: {},
      providerId: 'openai-production',
      allowanceObserver: observer,
      clock: { now: () => 1_700_000_000_000 },
    });

    expect(result).toBe(stream);
    expect(observer).toHaveBeenCalledOnce();
  });
});
