import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { GrokAcpClient } from './grokAcpClient.js';

function createPeer() {
  const stdin = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  child.stdin = {
    write(data) { stdin.emit('data', data); return true; },
    end() {},
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.exitCode = signal === 'SIGKILL' ? 137 : 0;
    child.emit('exit', child.exitCode);
  };
  let buffer = '';
  const inbound = [];
  stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) inbound.push(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
  });
  return {
    child,
    inbound,
    send(message) { stdout.emit('data', `${JSON.stringify(message)}\n`); },
  };
}

function scriptedSpawn(peer, respond) {
  return () => {
    queueMicrotask(() => respond(peer));
    return peer.child;
  };
}

describe('GrokAcpClient', () => {
  it('authenticates with cached_token and never sends an API key', async () => {
    const peer = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: scriptedSpawn(peer, (current) => {
        const init = current.inbound[0];
        expect(init.method).toBe('initialize');
        expect(init.params.clientCapabilities).toEqual({});
        current.send({
          jsonrpc: '2.0',
          id: init.id,
          result: { protocolVersion: 1, authMethods: [{ id: 'cached_token' }, { id: 'xai.api_key' }] },
        });
      }),
    });
    const pending = client.start();
    await waitFor(() => peer.inbound.some((message) => message.method === 'authenticate'));
    const auth = peer.inbound.find((message) => message.method === 'authenticate');
    expect(auth.params).toEqual({ methodId: 'cached_token', _meta: { headless: true } });
    expect(JSON.stringify(peer.inbound)).not.toContain('XAI_API_KEY');
    peer.send({ jsonrpc: '2.0', id: auth.id, result: {} });
    await expect(pending).resolves.toMatchObject({ authMethods: expect.any(Array) });
    await client.shutdown();
  });

  it('fails closed when cached_token is not advertised', async () => {
    const peer = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: scriptedSpawn(peer, (current) => {
        const init = current.inbound[0];
        current.send({ jsonrpc: '2.0', id: init.id, result: { authMethods: [{ id: 'xai.api_key' }] } });
      }),
    });
    await expect(client.start()).rejects.toMatchObject({ code: 'GROK_AUTH_REQUIRED' });
    await client.shutdown();
  });

  it('cancels a permission request and answers a question', async () => {
    const peer = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: scriptedSpawn(peer, (current) => {
        const init = current.inbound[0];
        current.send({ jsonrpc: '2.0', id: init.id, result: { authMethods: [{ id: 'cached_token' }] } });
      }),
      onQuestion: async () => ({ outcome: 'accepted', answers: { Q: ['A'] } }),
    });
    const pending = client.start();
    await waitFor(() => peer.inbound.some((message) => message.method === 'authenticate'));
    const auth = peer.inbound.find((message) => message.method === 'authenticate');
    peer.send({ jsonrpc: '2.0', id: auth.id, result: {} });
    await pending;
    peer.send({ jsonrpc: '2.0', id: 9, method: 'session/request_permission', params: {} });
    peer.send({ jsonrpc: '2.0', id: 10, method: 'askUserQuestion', params: { questions: [{ question: 'Q' }] } });
    await waitFor(() => peer.inbound.filter((message) => message.id === 9 || message.id === 10).length === 2);
    expect(peer.inbound.find((message) => message.id === 9).result).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(peer.inbound.find((message) => message.id === 10).result.outcome).toBe('accepted');
    await client.shutdown();
  });

  it('rejects malformed output', async () => {
    const peer = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: () => {
        queueMicrotask(() => peer.child.stdout.emit('data', 'not-json\n'));
        return peer.child;
      },
    });
    await expect(client.start()).rejects.toThrow(/malformed/);
  });

  it('times out initialize when Grok never answers', async () => {
    vi.useFakeTimers();
    try {
      const peer = createPeer();
      const client = new GrokAcpClient({ spawnImpl: () => peer.child });
      const pending = client.start();
      const expectation = expect(pending).rejects.toThrow(/timed out waiting for initialize/);
      await vi.advanceTimersByTimeAsync(20_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a missing binary and redacts secrets from a crash', async () => {
    const missing = createPeer();
    const notFound = new GrokAcpClient({
      spawnImpl: () => {
        queueMicrotask(() => missing.child.emit('error', Object.assign(new Error('spawn grok ENOENT'), { code: 'ENOENT' })));
        return missing.child;
      },
    });
    await expect(notFound.start()).rejects.toMatchObject({
      code: 'GROK_CLI_NOT_FOUND',
      message: 'Install Grok Build and ensure grok is on PATH.',
    });

    const crashed = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: () => {
        queueMicrotask(() => {
          crashed.child.stderr.emit('data', 'boom sk-SUPERSECRET\n');
          crashed.child.emit('exit', 1);
        });
        return crashed.child;
      },
    });
    await expect(client.start()).rejects.toThrow('Grok Build exited (1): boom [redacted]');
  });

  it('cancels the active session when the caller aborts', async () => {
    const peer = createPeer();
    const abortController = new AbortController();
    const client = new GrokAcpClient({
      spawnImpl: scriptedSpawn(peer, (current) => {
        const init = current.inbound[0];
        current.send({ jsonrpc: '2.0', id: init.id, result: { authMethods: [{ id: 'cached_token' }] } });
      }),
      signal: abortController.signal,
    });
    const pending = client.start();
    await waitFor(() => peer.inbound.some((message) => message.method === 'authenticate'));
    const auth = peer.inbound.find((message) => message.method === 'authenticate');
    peer.send({ jsonrpc: '2.0', id: auth.id, result: {} });
    await pending;
    client.sessionId = 'sess-1';
    abortController.abort();
    await waitFor(() => peer.inbound.some((message) => message.method === 'session/cancel'));
    expect(peer.inbound.find((message) => message.method === 'session/cancel').params).toEqual({ sessionId: 'sess-1' });
  });

  it('rejects an interaction it does not implement', async () => {
    const peer = createPeer();
    const client = new GrokAcpClient({
      spawnImpl: scriptedSpawn(peer, (current) => {
        const init = current.inbound[0];
        current.send({ jsonrpc: '2.0', id: init.id, result: { authMethods: [{ id: 'cached_token' }] } });
      }),
    });
    const pending = client.start();
    await waitFor(() => peer.inbound.some((message) => message.method === 'authenticate'));
    const auth = peer.inbound.find((message) => message.method === 'authenticate');
    peer.send({ jsonrpc: '2.0', id: auth.id, result: {} });
    await pending;
    peer.send({ jsonrpc: '2.0', id: 4, method: 'fs/read_text_file', params: {} });
    await waitFor(() => peer.inbound.some((message) => message.id === 4));
    expect(peer.inbound.find((message) => message.id === 4).error).toMatchObject({
      code: -32601,
      message: 'Unsupported Grok interaction: fs/read_text_file',
    });
    await client.shutdown();
  });
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for peer');
}
