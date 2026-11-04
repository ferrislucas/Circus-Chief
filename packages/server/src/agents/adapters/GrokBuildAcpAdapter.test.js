import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { GrokBuildAcpAdapter } from './GrokBuildAcpAdapter.js';

function createPeer({ prompt = 'ok', loadSession = true, sessionId = 'sess-1', configVia = 'top' } = {}) {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  let buffer = '';
  const inbound = [];
  child.stdin = {
    write(data) {
      buffer += data;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) {
          const message = JSON.parse(line);
          inbound.push(message);
          respond(message);
        }
        newline = buffer.indexOf('\n');
      }
      return true;
    },
    end() {},
  };
  child.stdout = stdout;
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); };
  function send(message) { stdout.emit('data', `${JSON.stringify(message)}\n`); }
  function respond(message) {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession },
          authMethods: [{ id: 'cached_token' }],
          _meta: { modelState: { currentModelId: 'grok-build', availableModels: ['grok-build'] } },
        },
      });
    } else if (message.method === 'authenticate') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'session/new') {
      expect(message.params._meta).toEqual({ yoloMode: true });
      expect(message.params.cwd).toBe('/work/tree');
      expect(message.params.mcpServers).toEqual([]);
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: sessionId ? sessionResult(sessionId, configVia) : {},
      });
    } else if (message.method === 'session/set_config_option') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'session/prompt') {
      if (prompt === 'hold') return;
      if (prompt === 'limit') {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32003, message: 'Usage limit reached' } });
        return;
      }
      if (prompt === 'rate_limit') {
        send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'rate_limit', _meta: { inputTokens: 2, outputTokens: 1 } } });
        return;
      }
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } } },
      });
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', _meta: { inputTokens: 1, outputTokens: 1 } } });
    } else if (message.method === 'session/load') {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD' } } },
      });
      send({ jsonrpc: '2.0', id: message.id, result: { configOptions: [] } });
    } else if (message.method === '_x.ai/billing') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { config: { creditUsagePercent: 20, currentPeriod: { end: '2026-06-01T00:00:00.000Z' } } },
      });
    }
  }
  return { inbound, spawn: () => child, child };
}

function sessionResult(sessionId, configVia) {
  const options = [{ id: 'model' }, { id: 'reasoning_effort' }];
  if (configVia === 'meta') {
    return { sessionId, _meta: { 'x.ai/sessionConfig': { options } } };
  }
  return { sessionId, configOptions: options };
}

async function collect(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe('GrokBuildAcpAdapter', () => {
  it('runs a first turn in the Circus worktree and streams text once', async () => {
    const peer = createPeer();
    const seen = [];
    const billed = [];
    const agent = new GrokBuildAcpAdapter({
      spawnImpl: peer.spawn,
      rememberModels: (ids) => seen.push(...ids),
      allowanceObserver: (candidate) => billed.push(candidate),
    });
    const events = await collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', model: 'grok-build', effortLevel: 'high', env: {}, providerId: 'xai-default' },
    }));
    expect(seen).toEqual(['grok-build']);
    expect(events.map((event) => event.type)).toEqual(['system', 'stream_event', 'assistant', 'result']);
    expect(events[0]).toMatchObject({ subtype: 'init', session_id: 'sess-1', model: 'grok-build' });
    expect(events[2].message.content[0].text).toBe('Hi');
    expect(events[3].usage).toEqual({ input_tokens: 1, output_tokens: 1 });
    expect(billed[0]).toMatchObject({ providerId: 'xai-default', providerKind: 'xai', allowances: [{ remainingPercent: 80 }] });
    const prompt = peer.inbound.find((message) => message.method === 'session/prompt');
    expect(prompt.params.prompt[0].text).toContain('Hello');
    expect(peer.inbound.some((message) => message.method === 'session/set_config_option' && message.params.configId === 'reasoning_effort')).toBe(true);
  });

  it('loads a native session instead of starting a new one', async () => {
    const peer = createPeer();
    const agent = new GrokBuildAcpAdapter({ spawnImpl: peer.spawn, rememberModels: () => {} });
    const events = await collect(agent.execute({
      prompt: 'Continue',
      options: { cwd: '/work/tree', resume: 'sess-9', env: {} },
    }));
    expect(peer.inbound.some((message) => message.method === 'session/new')).toBe(false);
    expect(peer.inbound.find((message) => message.method === 'session/load').params.sessionId).toBe('sess-9');
    expect(events.find((event) => event.subtype === 'init').session_id).toBe('sess-9');
    expect(events.find((event) => event.type === 'assistant').message.content[0].text).toBe('Hi');
    expect(JSON.stringify(events)).not.toContain('OLD');
  });

  it('applies model and effort when config options live under x.ai sessionConfig', async () => {
    const peer = createPeer({ configVia: 'meta' });
    const agent = new GrokBuildAcpAdapter({ spawnImpl: peer.spawn, rememberModels: () => {} });
    await collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', model: 'grok-4', effortLevel: 'high', env: {} },
    }));
    const sets = peer.inbound.filter((message) => message.method === 'session/set_config_option');
    expect(sets.map((message) => [message.params.configId, message.params.value])).toEqual([
      ['model', { value: 'grok-4' }],
      ['reasoning_effort', { value: 'high' }],
    ]);
  });

  it('clears the native id when restore fails', async () => {
    const peer = createPeer();
    const original = peer.spawn;
    const agent = new GrokBuildAcpAdapter({
      spawnImpl: () => {
        const child = original();
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (data) => {
          const message = JSON.parse(String(data).trim());
          if (message.method === 'session/load') {
            child.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { message: 'missing' } })}\n`);
            return true;
          }
          return write(data);
        };
        return child;
      },
      rememberModels: () => {},
    });
    const events = [];
    await expect((async () => {
      for await (const event of agent.execute({ prompt: 'x', options: { cwd: '/work/tree', resume: 'gone' } })) {
        events.push(event);
      }
    })()).rejects.toMatchObject({ code: 'GROK_RESUME_FAILED' });
    expect(events[0]).toMatchObject({ type: 'system', session_id: null });
  });

  it('reads billing after a usage-limit prompt error', async () => {
    const peer = createPeer({ prompt: 'limit' });
    const billed = [];
    const agent = new GrokBuildAcpAdapter({
      spawnImpl: peer.spawn,
      rememberModels: () => {},
      allowanceObserver: (candidate) => billed.push(candidate),
    });
    await expect(collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', env: {}, providerId: 'xai-default' },
    }))).rejects.toMatchObject({ message: 'Usage limit reached', code: -32003 });
    expect(billed[0]).toMatchObject({
      providerId: 'xai-default',
      providerKind: 'xai',
      allowances: [{ remainingPercent: 80 }],
    });
  });

  it('treats a rate_limit stop as a finished turn', async () => {
    const peer = createPeer({ prompt: 'rate_limit' });
    const agent = new GrokBuildAcpAdapter({ spawnImpl: peer.spawn, rememberModels: () => {} });
    const events = await collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', env: {} },
    }));
    expect(events.find((event) => event.type === 'result')).toMatchObject({
      subtype: 'success',
      usage: { input_tokens: 2, output_tokens: 1 },
    });
  });

  it('skips billing and cancels the native session when the turn is aborted', async () => {
    const peer = createPeer({ prompt: 'hold' });
    const billed = [];
    const abortController = new AbortController();
    const agent = new GrokBuildAcpAdapter({
      spawnImpl: peer.spawn,
      rememberModels: () => {},
      allowanceObserver: (candidate) => billed.push(candidate),
    });
    const pending = collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', env: {}, abortController, providerId: 'xai-default' },
    }));
    await waitFor(() => peer.inbound.some((message) => message.method === 'session/prompt'));
    abortController.abort();
    await expect(pending).rejects.toThrow(/process closed/);
    const cancel = peer.inbound.find((message) => message.method === 'session/cancel');
    expect(cancel.params).toEqual({ sessionId: 'sess-1' });
    expect(billed).toEqual([]);
  });

  it('redacts a crashed process and does not bill a closed child', async () => {
    const peer = createPeer({ prompt: 'hold' });
    const billed = [];
    const agent = new GrokBuildAcpAdapter({
      spawnImpl: peer.spawn,
      rememberModels: () => {},
      allowanceObserver: (candidate) => billed.push(candidate),
    });
    const pending = collect(agent.execute({
      prompt: 'Hello',
      options: { cwd: '/work/tree', env: {}, providerId: 'xai-default' },
    }));
    await waitFor(() => peer.inbound.some((message) => message.method === 'session/prompt'));
    peer.child.stderr.emit('data', 'boom sk-SUPERSECRET\n');
    peer.child.emit('exit', 1);
    await expect(pending).rejects.toThrow(/Grok Build exited \(1\): boom \[redacted\]/);
    await expect(pending).rejects.not.toThrow(/SUPERSECRET/);
    expect(billed).toEqual([]);
  });

  it('requires a working directory and a session id', async () => {
    const agent = new GrokBuildAcpAdapter({ spawnImpl: () => { throw new Error('should not spawn'); } });
    await expect(collect(agent.execute({ prompt: 'x', options: {} }))).rejects.toMatchObject({ code: 'GROK_NO_CWD' });

    const peer = createPeer({ sessionId: null });
    const started = new GrokBuildAcpAdapter({ spawnImpl: peer.spawn, rememberModels: () => {} });
    await expect(collect(started.execute({
      prompt: 'x',
      options: { cwd: '/work/tree', env: {} },
    }))).rejects.toMatchObject({ code: 'GROK_NO_SESSION' });
  });

  it('refuses to resume when this Grok version cannot load a session', async () => {
    const peer = createPeer({ loadSession: false });
    const agent = new GrokBuildAcpAdapter({ spawnImpl: peer.spawn, rememberModels: () => {} });
    const events = [];
    await expect((async () => {
      for await (const event of agent.execute({
        prompt: 'x',
        options: { cwd: '/work/tree', resume: 'gone', model: 'grok-build' },
      })) events.push(event);
    })()).rejects.toMatchObject({ code: 'GROK_RESUME_UNSUPPORTED' });
    expect(events[0]).toMatchObject({ type: 'system', session_id: null, model: 'grok-build' });
  });
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for peer');
}
