import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { GrokBuildAcpAdapter } from './GrokBuildAcpAdapter.js';

function createPeer() {
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
          agentCapabilities: { loadSession: true },
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
        result: { sessionId: 'sess-1', configOptions: [{ id: 'model' }, { id: 'reasoning_effort' }] },
      });
    } else if (message.method === 'session/set_config_option') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'session/prompt') {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } } },
      });
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn', _meta: { inputTokens: 1, outputTokens: 1 } } });
    } else if (message.method === 'session/load') {
      send({ jsonrpc: '2.0', id: message.id, result: { configOptions: [] } });
    } else if (message.method === '_x.ai/billing') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { config: { creditUsagePercent: 20, currentPeriod: { end: '2026-06-01T00:00:00.000Z' } } },
      });
    }
  }
  return { inbound, spawn: () => child };
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
});
