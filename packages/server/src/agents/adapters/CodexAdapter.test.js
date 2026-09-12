import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { CodexAdapter } from './CodexAdapter.js';
import { BaseAgent } from '../BaseAgent.js';

function createAppServerChild(capture) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.emitMessage = (message) => child.stdout.push(`${JSON.stringify(message)}\n`);
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.toString());
      capture.requests.push(request);
      if (request.method === 'initialize') child.emitMessage({ id: request.id, result: {
        userAgent: 'Circus Chief/0.145.0 (Mac OS; x86_64)', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos',
      } });
      if (request.method === 'thread/start') child.emitMessage({ id: request.id, result: { thread: { id: 'thread-1' } } });
      if (request.method === 'turn/start') {
        child.emitMessage({ id: request.id, result: { turn: { id: 'turn-1' } } });
        child.emitMessage({ method: 'item/completed', params: { item: { id: 'message-1', type: 'agent_message', text: 'App Server response' } } });
        child.emitMessage({ method: 'turn/completed', params: { turn: { usage: { input_tokens: 3, output_tokens: 2 } } } });
      }
      callback();
    },
  });
  return child;
}

async function collect(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

afterEach(() => { delete process.env.USE_CODEX_DIRECT_API; });

describe('CodexAdapter', () => {
  it('extends BaseAgent and advertises App Server interaction support by default', () => {
    const adapter = new CodexAdapter();
    expect(adapter).toBeInstanceOf(BaseAgent);
    expect(adapter.getCapabilities()).toEqual({
      streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false, interactiveInput: true,
    });
  });

  it('uses App Server by default', async () => {
    const capture = { requests: [] };
    const spawn = vi.fn(() => createAppServerChild(capture));
    const adapter = new CodexAdapter({ spawnCodexProcess: spawn });

    const events = await collect(adapter.execute({ prompt: 'hello', options: {
      cwd: '/workspace/project', model: 'gpt-5-codex', env: {}, abortController: new AbortController(),
    } }, { sessionId: 'session-1', conversationId: 'conversation-1' }));

    expect(spawn.mock.calls[0][0].args).toContain('app-server');
    expect(capture.requests.map((request) => request.method)).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start']);
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('preserves sandbox, model, effort, system prompt, and redacted MCP configuration', async () => {
    const capture = { requests: [] };
    const spawn = vi.fn(() => createAppServerChild(capture));
    const adapter = new CodexAdapter({ spawnCodexProcess: spawn });
    await collect(adapter.execute({ prompt: 'inspect', options: {
      cwd: '/workspace/project', model: 'gpt-5-codex', sandboxMode: 'read-only', effortLevel: 'max', systemPrompt: 'Keep changes small.',
      mcpServers: { local: { command: 'node', args: ['mcp.js'], env: { MCP_TOKEN: 'top-secret' } } }, env: { PATH: '/usr/bin' }, abortController: new AbortController(),
    } }, { sessionId: 'session-1', conversationId: 'conversation-1' }));
    const spawnArgs = spawn.mock.calls[0][0];
    expect(spawnArgs).toMatchObject({ command: 'codex', cwd: '/workspace/project', env: { PATH: '/usr/bin', MCP_TOKEN: 'top-secret' } });
    expect(spawnArgs.args.join(' ')).not.toContain('top-secret');
    expect(capture.requests.find((request) => request.method === 'thread/start').params).toMatchObject({ cwd: '/workspace/project', model: 'gpt-5-codex', sandbox: 'read-only', developerInstructions: 'Keep changes small.' });
    expect(capture.requests.find((request) => request.method === 'turn/start').params).toMatchObject({ effort: 'xhigh' });
  });

  it('uses the direct API only when explicitly selected and reports it as non-interactive', async () => {
    process.env.USE_CODEX_DIRECT_API = '1';
    const create = vi.fn(async function *stream() { yield { choices: [{ delta: { content: 'Hello' } }] }; });
    const adapter = new CodexAdapter({ openaiClientFactory: () => ({ chat: { completions: { create } } }) });
    expect(adapter.getCapabilities().interactiveInput).toBe(false);
    const events = await collect(adapter.execute({ prompt: 'hello', options: { model: 'gpt-5-codex', env: {}, abortController: new AbortController() } }));
    expect(create).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
});
