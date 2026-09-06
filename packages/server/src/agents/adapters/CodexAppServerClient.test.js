import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { CodexAppServerClient } from './CodexAppServerClient.js';

function createAppServerChild(initializeResult) {
  const child = new EventEmitter();
  child.requests = [];
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.toString());
      child.requests.push(request);
      if (request.method === 'initialize') {
        child.stdout.push(`${JSON.stringify({ id: request.id, result: initializeResult })}\n`);
      }
      callback();
    },
  });
  return child;
}

describe('CodexAppServerClient initialization compatibility', () => {
  it('accepts only an experimental API-capable initialization response', async () => {
    const child = createAppServerChild({ capabilities: { experimentalApi: true } });
    const client = new CodexAppServerClient({ child });

    await expect(client.initialize()).resolves.toBeUndefined();
    expect(child.requests).toEqual([
      expect.objectContaining({ method: 'initialize', params: expect.objectContaining({ capabilities: { experimentalApi: true } }) }),
      { method: 'initialized', params: {} },
    ]);
    client.close();
  });

  it.each([
    ['missing capabilities', {}],
    ['experimental API unavailable', { capabilities: { experimentalApi: false } }],
    ['changed capabilities schema', { capabilities: ['experimentalApi'] }],
  ])('rejects %s before a turn can start', async (_name, initializeResult) => {
    const child = createAppServerChild(initializeResult);
    const client = new CodexAppServerClient({ child });

    await expect(client.initialize()).rejects.toThrow('Codex App Server is incompatible: experimentalApi capability is required');
    expect(client.closed).toBe(true);
  });

  it('surfaces initialization errors as compatibility failures', async () => {
    const child = createAppServerChild(undefined);
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(chunk.toString());
        child.stdout.push(`${JSON.stringify({ id: request.id, error: { code: -32601, message: 'initialize unsupported' } })}\n`);
        callback();
      },
    });
    const client = new CodexAppServerClient({ child });

    await expect(client.initialize()).rejects.toThrow('Codex App Server initialization failed: initialize unsupported');
    expect(client.closed).toBe(true);
  });
});
