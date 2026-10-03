import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIStream, observeOpenAIAllowance } from './openaiDirectApi.js';

const HEADERS = {
  'x-ratelimit-limit-requests': '100',
  'x-ratelimit-remaining-requests': '75',
  'x-ratelimit-reset-requests': '12s',
  'x-ratelimit-limit-tokens': '100000',
  'x-ratelimit-remaining-tokens': '75000',
  'x-ratelimit-reset-tokens': '2m0s',
};

const FLAG_ENV = ['PROVIDER_ALLOWANCES_ENABLED', 'PROVIDER_ALLOWANCES_OPENAI'];
const savedEnv = Object.fromEntries(FLAG_ENV.map((name) => [name, process.env[name]]));

function setFlags(master, openai) {
  if (master === undefined) delete process.env.PROVIDER_ALLOWANCES_ENABLED;
  else process.env.PROVIDER_ALLOWANCES_ENABLED = master;
  if (openai === undefined) delete process.env.PROVIDER_ALLOWANCES_OPENAI;
  else process.env.PROVIDER_ALLOWANCES_OPENAI = openai;
}

afterEach(() => {
  for (const name of FLAG_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe('observeOpenAIAllowance source gate', () => {
  it('stays inert when the master flag is on but the OpenAI source flag is off', () => {
    setFlags('1', undefined);
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).not.toHaveBeenCalled();
  });

  it('stays inert when the master flag is off even if the OpenAI source flag is on', () => {
    setFlags(undefined, '1');
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).not.toHaveBeenCalled();
  });

  it('observes only when both the master and OpenAI source flags are on', () => {
    setFlags('1', '1');
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      providerId: 'openai-production',
      source: 'observed-header',
    }));
  });

  it('rejects non-literal opt-ins for the OpenAI source flag', () => {
    setFlags('1', 'true');
    const observer = vi.fn();

    observeOpenAIAllowance({ headers: HEADERS, providerId: 'openai-production', allowanceObserver: observer, clock: { now: () => 1_700_000_000_000 } });

    expect(observer).not.toHaveBeenCalled();
  });

  it('still returns the stream while skipping observation when the source flag is off', async () => {
    setFlags('1', undefined);
    const observer = vi.fn();
    const stream = [{ choices: [{ delta: { content: 'hi' } }] }];
    const client = { chat: { completions: { create: vi.fn(async () => stream) } } };

    const result = await createOpenAIStream({
      client,
      request: { model: 'gpt-4o-mini', messages: [], stream: true },
      requestOptions: {},
      providerId: 'openai-production',
      allowanceObserver: observer,
      clock: { now: () => 1_700_000_000_000 },
    });

    expect(result).toBe(stream);
    expect(observer).not.toHaveBeenCalled();
  });
});
