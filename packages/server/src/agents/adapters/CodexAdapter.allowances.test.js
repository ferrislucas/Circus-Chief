import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { CodexAdapter } from './CodexAdapter.js';
import { ProviderAllowanceService } from '../../services/ProviderAllowanceService.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'openai', 'allowance-headers.json',
);
const headers = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).complete;

async function collect(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

function fixtureResponse(responseHeaders = headers) {
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'done' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
    },
  };
  const request = {
    withResponse: vi.fn(async () => ({ data: stream, response: { headers: new Headers(headers) } })),
    [Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream),
  };
  request.withResponse.mockImplementation(async () => ({ data: stream, response: { headers: new Headers(responseHeaders) } }));
  return request;
}

describe('CodexAdapter OpenAI allowance observation', () => {
  it('observes an actual OpenAI SDK response through the adapter boundary and broadcasts the normalized snapshot', async () => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [{ id: 'openai-production', name: 'OpenAI Production', kind: 'openai', enabled: true }] },
      broadcaster,
      clock: { now: () => 1_700_000_000_000 },
    });
    const create = vi.fn(() => fixtureResponse());
    const adapter = new CodexAdapter({
      openaiClientFactory: () => ({ chat: { completions: { create } } }),
      allowanceObserver: service.observe.bind(service),
      clock: { now: () => 1_700_000_000_000 },
    });

    await collect(adapter._executeDirectApi({
      prompt: 'hello',
      options: { model: 'gpt-4o-mini', env: { OPENAI_API_KEY: 'sk-test' }, providerId: 'openai-production' },
    }, { model: 'gpt-4o-mini', env: { OPENAI_API_KEY: 'sk-test' }, providerId: 'openai-production' }));

    expect(service.getSnapshots()).toEqual([expect.objectContaining({
      providerId: 'openai-production', status: 'available', source: 'observed-header',
      allowances: [
        expect.objectContaining({ key: 'requests', remaining: 75, limit: 100, remainingPercent: 75 }),
        expect.objectContaining({ key: 'tokens', remaining: 75_000, limit: 100_000, remainingPercent: 75 }),
      ],
    })]);
    expect(broadcaster).toHaveBeenCalledWith(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, {
      snapshot: expect.objectContaining({ providerId: 'openai-production' }),
    });
    expect(JSON.stringify(service.getSnapshots())).not.toMatch(/authorization|redacted|req_sanitized|headers/i);
  });

  it.each([
    ['unsupported provider kind', 'other-provider', { id: 'other-provider', name: 'Other', kind: 'anthropic', enabled: true }, headers],
    ['partial headers', 'openai-production', { id: 'openai-production', name: 'OpenAI Production', kind: 'openai', enabled: true }, { 'x-ratelimit-limit-requests': '100' }],
    ['malformed headers', 'openai-production', { id: 'openai-production', name: 'OpenAI Production', kind: 'openai', enabled: true }, { 'x-ratelimit-limit-requests': 'bad', 'x-ratelimit-remaining-requests': '-1' }],
    ['disabled provider', 'openai-production', { id: 'openai-production', name: 'OpenAI Production', kind: 'openai', enabled: false }, headers],
    ['unknown provider', 'missing-provider', { id: 'openai-production', name: 'OpenAI Production', kind: 'openai', enabled: true }, headers],
  ])('leaves %s unknown when no valid production observation is available', async (_caseName, providerId, provider, responseHeaders) => {
    const broadcaster = vi.fn();
    const service = new ProviderAllowanceService({ providerRepository: { getAll: () => [provider] }, broadcaster });
    const adapter = new CodexAdapter({
      openaiClientFactory: () => ({
        chat: { completions: { create: vi.fn(() => fixtureResponse(responseHeaders)) } },
      }),
      allowanceObserver: service.observe.bind(service),
    });

    await collect(adapter._executeDirectApi({ prompt: 'hello', options: { model: 'gpt-4o-mini', env: { OPENAI_API_KEY: 'sk-test' }, providerId } }, { model: 'gpt-4o-mini', env: { OPENAI_API_KEY: 'sk-test' }, providerId }));

    expect(service.getSnapshots().every((snapshot) => snapshot.status === 'unknown')).toBe(true);
    expect(broadcaster).not.toHaveBeenCalled();
  });
});
