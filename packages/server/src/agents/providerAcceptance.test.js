import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, PassThrough } from 'stream';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'mock-session-id' };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    yield { type: 'result', subtype: 'success' };
  }),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter.js';
import { CodexAdapter, _resetCodexCliUnavailableForTests } from './adapters/CodexAdapter.js';
import { GeminiAdapter, _resetGeminiCliUnavailableForTests } from './adapters/GeminiAdapter.js';
import { MuseExecAdapter } from './adapters/MuseExecAdapter.js';

function collectInOrder(generator, onEvent) {
  const events = [];
  return (async () => {
    for await (const event of generator) {
      onEvent?.();
      events.push(event);
    }
    return events;
  })();
}

function codexChild({ pid = 1111, lines = [], exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  process.nextTick(() => {
    for (const line of lines) child.stdout.push(`${line}\n`);
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit('exit', exitCode);
  });
  return child;
}

const CODEX_LINES = [
  '{"type":"thread.started","thread_id":"codex-xyz"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agentMessage","text":"Hello"}}',
  '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}}',
];

function geminiChild({ pid = 2222 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  return child;
}

function museChild({ pid = 4242, output = [] } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.end(output.length ? `${output.join('\n')}\n` : '');
    child.stderr.end();
    child.emit('exit', 0);
  });
  return child;
}

const museRun = (text = 'Finished') => [
  JSON.stringify({ schema_version: 1, record_type: 'event', sequence: 1, payload_type: 'runtime.command.accepted', payload: { command_id: 'cmd-1' } }),
  JSON.stringify({ schema_version: 1, record_type: 'event', sequence: 2, payload_type: 'session.run.linked', payload: { command_id: 'cmd-1', run_stream: { id: 'run-1' } } }),
  JSON.stringify({ schema_version: 1, record_type: 'event', sequence: 3, payload_type: 'run.lifecycle.started', payload: {} }),
  JSON.stringify({ schema_version: 1, record_type: 'event', sequence: 4, payload_type: 'run.terminal.completed', payload: { command_id: 'cmd-1', run_stream: { id: 'run-1' }, terminal: 'completed', text } }),
];

describe('provider acceptance signaling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_CODEX_DIRECT_API;
  });

  afterEach(() => {
    _resetCodexCliUnavailableForTests();
    _resetGeminiCliUnavailableForTests();
    delete process.env.USE_CODEX_DIRECT_API;
  });

  it('claude-code signals on the first SDK protocol event, exactly once', async () => {
    const seen = [];
    const meta = { sessionId: 's1', onProviderAccepted: (detail) => seen.push(detail) };
    const adapter = new ClaudeCodeAdapter({});

    const order = [];
    const events = await collectInOrder(adapter.execute({ prompt: 'hi' }, meta), () => order.push('event'));

    expect(events.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ adapterType: 'claude-code', boundary: 'provider_protocol_ack', sessionId: 's1' });
  });

  it('codex CLI signals at confirmed subprocess start, before stream events', async () => {
    const order = [];
    const meta = { sessionId: 's2', onProviderAccepted: (detail) => order.push(['accepted', detail]) };
    const adapter = new CodexAdapter({ spawnCodexProcess: () => codexChild({ lines: CODEX_LINES }) });

    const events = await collectInOrder(
      adapter.execute({ prompt: 'hi', options: { model: 'gpt-5', cwd: '/tmp', env: {} } }, meta),
      () => order.push(['event']),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(order[0][0]).toBe('accepted');
    expect(order[0][1]).toMatchObject({ adapterType: 'codex', boundary: 'subprocess_start', pid: 1111 });
    expect(order.filter(([kind]) => kind === 'accepted')).toHaveLength(1);
  });

  it('codex CLI does not signal when the spawn itself fails', async () => {
    const seen = [];
    const enoent = new Error('spawn codex ENOENT');
    enoent.code = 'ENOENT';
    const adapter = new CodexAdapter({
      spawnCodexProcess: () => { throw enoent; },
    });

    await expect(
      collectInOrder(
        adapter.execute({ prompt: 'hi', options: { model: 'gpt-5', cwd: '/tmp', env: {} } }, { onProviderAccepted: (detail) => seen.push(detail) }),
      ),
    ).rejects.toThrow(/Codex CLI not found/);
    expect(seen).toHaveLength(0);
  });

  it('codex direct-API signals once the streaming request is accepted', async () => {
    process.env.USE_CODEX_DIRECT_API = '1';
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Hello' } }] };
      },
    };
    const create = vi.fn(async () => fakeStream);
    const adapter = new CodexAdapter({ openaiClientFactory: () => ({ chat: { completions: { create } } }) });
    const seen = [];

    const events = await collectInOrder(
      adapter.execute(
        { prompt: 'hi', options: { model: 'gpt-4o-mini', env: { OPENAI_API_KEY: 'sk-test' }, abortController: new AbortController() } },
        { sessionId: 's3', onProviderAccepted: (detail) => seen.push(detail) },
      ),
    );

    expect(create).toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ adapterType: 'codex', boundary: 'stream_accepted' });
    expect(events.length).toBeGreaterThan(0);
  });

  it('gemini signals at confirmed subprocess start', async () => {
    const child = geminiChild();
    const seen = [];
    const adapter = new GeminiAdapter({ spawnGeminiProcess: () => child });

    const pending = collectInOrder(
      adapter.execute({ prompt: 'hi', options: { model: 'gemini-2.5-flash', cwd: '/tmp', env: {} } }, { onProviderAccepted: (detail) => seen.push(detail) }),
    );
    setTimeout(() => {
      child.stdout.push(`${JSON.stringify({ type: 'result', status: 'success', stats: {} })}\n`);
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit('exit', 0);
    }, 10);
    await pending;

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ adapterType: 'gemini', boundary: 'subprocess_start', pid: 2222 });
  });

  it('muse signals after the exec child exists, not on the synthetic init', async () => {
    const seen = [];
    const adapter = new MuseExecAdapter({ spawnMuseExec: () => museChild({ output: museRun() }) });

    const events = await collectInOrder(
      adapter.execute(
        { prompt: 'Hi', options: { cwd: '/tmp', env: {} } },
        { sessionId: 's4', onProviderAccepted: (detail) => seen.push(detail) },
      ),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ adapterType: 'muse', boundary: 'subprocess_start', pid: 4242 });
  });

  it('muse does not signal when spawn throws before any provider exists', async () => {
    const seen = [];
    const adapter = new MuseExecAdapter({
      spawnMuseExec: () => { throw new Error('spawn muse ENOENT'); },
    });

    const events = await collectInOrder(
      adapter.execute(
        { prompt: 'Hi', options: { cwd: '/tmp', env: {} } },
        { onProviderAccepted: (detail) => seen.push(detail) },
      ),
    );

    expect(seen).toHaveLength(0);
    expect(events[events.length - 1]).toMatchObject({ type: 'result', subtype: 'error' });
  });

  it('a throwing observer never breaks the provider stream', async () => {
    const adapter = new ClaudeCodeAdapter({});
    const events = [];
    for await (const event of adapter.execute({ prompt: 'hi' }, {
      onProviderAccepted: () => { throw new Error('observer blew up'); },
    })) events.push(event);
    expect(events.length).toBeGreaterThan(0);
  });
});
