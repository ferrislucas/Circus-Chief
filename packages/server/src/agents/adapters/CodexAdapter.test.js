import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodexAdapter, _resetCodexCliUnavailableForTests } from './CodexAdapter.js';
import { BaseAgent } from '../BaseAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  '..', '..', '..', 'tests', 'fixtures', 'codex', 'basic-turn.jsonl'
);

// --- helpers ---------------------------------------------------------------

/**
 * Create a fake child process that emits the given stdout text (possibly over
 * multiple chunks), optional stderr, and an exit code.
 *
 * @param {Object} opts
 * @param {string[]} [opts.stdoutLines]
 * @param {string|string[]} [opts.stderr] - Single string or array of chunks to
 *   push separately (useful for testing multi-chunk buffering).
 * @param {number} [opts.exitCode]
 * @param {Error|null} [opts.emitError]
 * @param {Object|null} [opts.captureStdin]
 */
function createFakeChild({ stdoutLines = [], stderr = '', exitCode = 0, emitError = null, captureStdin = null } = {}) {
  const child = new EventEmitter();
  const stdinCapture = captureStdin;

  // Readable stdout that emits each line (with newline) as its own chunk, then ends.
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  // Writable stdin that either swallows data or captures it for later assertions
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      if (stdinCapture) stdinCapture.chunks.push(chunk.toString('utf-8'));
      cb();
    },
    final(cb) {
      if (stdinCapture) stdinCapture.ended = true;
      cb();
    },
  });
  child.kill = vi.fn();

  // After nextTick, start pushing lines
  process.nextTick(() => {
    if (emitError) {
      child.emit('error', emitError);
      return;
    }
    for (const line of stdoutLines) {
      child.stdout.push(`${line}\n`);
    }
    child.stdout.push(null);

    // stderr may be a string or an array of chunks
    const stderrChunks = Array.isArray(stderr) ? stderr : (stderr ? [stderr] : []);
    for (const chunk of stderrChunks) {
      child.stderr.push(chunk);
    }
    child.stderr.push(null);

    // Allow stream consumers to drain before exit
    setImmediate(() => {
      child.emit('exit', exitCode);
    });
  });

  return child;
}

function loadFixture() {
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  return raw.trim().split('\n').filter(Boolean);
}

async function collect(gen) {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
}

// --- tests -----------------------------------------------------------------

describe('CodexAdapter', () => {
  beforeEach(() => {
    _resetCodexCliUnavailableForTests();
    delete process.env.USE_CODEX_DIRECT_API;
  });

  afterEach(() => {
    delete process.env.USE_CODEX_DIRECT_API;
  });

  it('extends BaseAgent', () => {
    const adapter = new CodexAdapter();
    expect(adapter).toBeInstanceOf(BaseAgent);
  });

  it('instance getCapabilities() returns the expected shape', () => {
    const adapter = new CodexAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      thinking: false,
      reasoningEffort: true,
      toolUse: true,
      resume: false,
    });
  });

  it('static CodexAdapter.capabilities deep-equals the instance shape', () => {
    const adapter = new CodexAdapter();
    expect(CodexAdapter.capabilities).toEqual(adapter.getCapabilities());
  });

  it('supportsResume() returns false', () => {
    const adapter = new CodexAdapter();
    expect(adapter.supportsResume()).toBe(false);
  });

  it('CLI path: yields expected normalized events from the real-schema fixture', async () => {
    const lines = loadFixture();
    const fakeSpawn = vi.fn(() => createFakeChild({ stdoutLines: lines, exitCode: 0 }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    const events = await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: {},
        abortController: new AbortController(),
      },
    }));

    // Expected: system(init), stream_event(text_delta), assistant, result(success)
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', session_id: 'codex-xyz', model: 'gpt-4o' });
    expect(events[1]).toMatchObject({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello, world' } },
    });
    expect(events[2]).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello, world' }] },
    });
    expect(events[3]).toMatchObject({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 12, output_tokens: 4 },
    });
    expect(events).toHaveLength(4);

    // Verify real CLI invocation shape
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.command).toBe('codex');
    expect(spawnArgs.args.slice(0, 5)).toEqual([
      'exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write',
    ]);
    expect(spawnArgs.args).toContain('-m');
    expect(spawnArgs.args).toContain('gpt-4o');
  });

  it('CLI path: honors sandboxMode option', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-a"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        sandboxMode: 'read-only',
        cwd: process.cwd(),
        env: {},
        abortController: new AbortController(),
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    const sandboxIdx = spawnArgs.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(spawnArgs.args[sandboxIdx + 1]).toBe('read-only');
  });

  it('CLI path: appends -c preferred_auth_method=chatgpt when no OPENAI_API_KEY in env', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-c"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { HOME: '/tmp', PATH: '/usr/bin' },
        abortController: new AbortController(),
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    const cIdx = spawnArgs.args.indexOf('-c');
    expect(cIdx).toBeGreaterThan(-1);
    expect(spawnArgs.args[cIdx + 1]).toBe('preferred_auth_method=chatgpt');
  });

  it('CLI path: does NOT append -c preferred_auth_method=chatgpt when OPENAI_API_KEY is in env', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-d"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test-key' },
        abortController: new AbortController(),
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.args).not.toContain('-c');
  });

  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['max', 'xhigh'],
  ])('CLI path: maps effortLevel=%s to Codex reasoning config %s', async (effortLevel, expected) => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-effort"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test-key' },
        abortController: new AbortController(),
        effortLevel,
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.args).toContain(`model_reasoning_effort=${expected}`);
    expect(spawnArgs.args).toContain(`plan_mode_reasoning_effort=${expected}`);
  });

  it.each([null, 'auto', 'unknown'])('CLI path: omits reasoning config for effortLevel=%s', async (effortLevel) => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-no-effort"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test-key' },
        abortController: new AbortController(),
        effortLevel,
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.args).not.toContain('model_reasoning_effort=');
    expect(spawnArgs.args).not.toContain('plan_mode_reasoning_effort=');
    expect(spawnArgs.args.some((arg) => arg.startsWith('model_reasoning_effort='))).toBe(false);
    expect(spawnArgs.args.some((arg) => arg.startsWith('plan_mode_reasoning_effort='))).toBe(false);
  });

  it('CLI path: reasoning config composes with ChatGPT auth config', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-auth-effort"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { HOME: '/tmp', PATH: '/usr/bin' },
        abortController: new AbortController(),
        effortLevel: 'high',
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.args).toContain('model_reasoning_effort=high');
    expect(spawnArgs.args).toContain('plan_mode_reasoning_effort=high');
    expect(spawnArgs.args).toContain('preferred_auth_method=chatgpt');
  });

  it('CLI path: prepends systemPrompt onto stdin prompt', async () => {
    const capture = { chunks: [], ended: false };
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-b"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
      captureStdin: capture,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'please summarize the repo',
      options: {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful coding assistant.',
        cwd: process.cwd(),
        env: {},
        abortController: new AbortController(),
      },
    }));

    const joined = capture.chunks.join('');
    expect(joined).toContain('SYSTEM PROMPT:');
    expect(joined).toContain('You are a helpful coding assistant.');
    expect(joined).toContain('USER:');
    expect(joined).toContain('please summarize the repo');
  });

  it('CLI path: spawner throws ENOENT → rejects with CODEX_CLI_NOT_FOUND', async () => {
    const err = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    const fakeSpawn = vi.fn(() => { throw err; });
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    try {
      await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('CODEX_CLI_NOT_FOUND');
  });

  it('CLI path: non-empty stderr → rejects with message containing stderr text', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: [],
      stderr: 'boom: something went wrong',
      exitCode: 1,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    try {
      await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toContain('boom');
    expect(caught.code).toBe('CODEX_CLI_EXIT');
    expect(caught.exitCode).toBe(1);
  });

  it('CLI path: stderr trimming — trailing newline is stripped from error message', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: [],
      stderr: 'error: model not found\n',
      exitCode: 1,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    try {
      await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toBe('error: model not found');
    expect(caught.code).toBe('CODEX_CLI_EXIT');
    expect(caught.exitCode).toBe(1);
  });

  it('CLI path: multi-chunk stderr is concatenated before being surfaced', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: [],
      stderr: ['first part ', 'second part'],
      exitCode: 1,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    try {
      await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toBe('first part second part');
    expect(caught.code).toBe('CODEX_CLI_EXIT');
  });

  it('CLI path: informational stderr + valid stdout + exit 0 → session succeeds normally', async () => {
    const lines = loadFixture();
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: lines,
      stderr: 'Reading prompt from stdin...\n',
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    let events = [];
    try {
      events = await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeNull();
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', session_id: 'codex-xyz', model: 'gpt-4o' });
    expect(events[1]).toMatchObject({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello, world' } },
    });
    expect(events[2]).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello, world' }] },
    });
    expect(events[3]).toMatchObject({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 12, output_tokens: 4 },
    });
    expect(events).toHaveLength(4);
    expect(events.some(e => e.subtype === 'error')).toBe(false);
  });

  it('CLI path: informational stderr + no stdout + exit 0 → session completes without error', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: [],
      stderr: 'Reading prompt from stdin...\n',
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    let caught = null;
    let events = [];
    try {
      events = await collect(adapter.execute({
        prompt: 'hi',
        options: { model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: new AbortController() },
      }));
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeNull();
    // The mapper's finalize() emits a result(success) even with no stdout;
    // the important thing is no error was thrown and no result(error) was emitted.
    expect(events.some(e => e.subtype === 'error')).toBe(false);
    expect(events.every(e => e.type !== undefined)).toBe(true);
  });

  it('CLI path: abort triggers SIGTERM then (after 2s) SIGKILL', async () => {
    vi.useFakeTimers();
    let createdChild = null;
    const fakeSpawn = vi.fn(() => {
      // Never emits exit until we force it via abort; provide a long-lived child
      const child = new EventEmitter();
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
      child.kill = vi.fn((_sig) => {
        // Only emit exit when SIGKILL is requested (simulating an unresponsive child)
        if (_sig === 'SIGKILL') {
          process.nextTick(() => {
            child.stdout.push(null);
            child.stderr.push(null);
            child.emit('exit', 137);
          });
        }
      });
      createdChild = child;
      return child;
    });

    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });
    const controller = new AbortController();

    const runPromise = collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o', cwd: process.cwd(), env: {}, abortController: controller,
      },
    })).catch((e) => e);

    // Wait a tick so spawn + listeners are wired
    await Promise.resolve();
    await Promise.resolve();

    // Trigger abort
    controller.abort();

    // SIGTERM should be called synchronously
    expect(createdChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Advance 2s → SIGKILL
    await vi.advanceTimersByTimeAsync(2000);
    expect(createdChild.kill).toHaveBeenCalledWith('SIGKILL');

    // Let all pending promises flush
    await vi.runAllTimersAsync();
    const result = await runPromise;
    // The result is either an error (non-zero exit) or a set of events —
    // either way the generator must terminate.
    expect(result).toBeDefined();

    vi.useRealTimers();
  });

  it('Direct-API path: yields init, deltas, assistant, result with usage from stream', async () => {
    process.env.USE_CODEX_DIRECT_API = '1';

    const streamChunks = [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
    ];

    const fakeStream = {
      controller: { abort: vi.fn() },
      async *[Symbol.asyncIterator]() {
        for (const c of streamChunks) yield c;
      },
    };

    class FakeClient {
      constructor() {
        this.chat = {
          completions: {
            create: vi.fn(async () => fakeStream),
          },
        };
      }
    }

    const client = new FakeClient();
    const openaiClientFactory = () => client;

    const adapter = new CodexAdapter({ openaiClientFactory });
    const events = await collect(adapter.execute({
      prompt: 'say hi',
      options: {
        model: 'gpt-4o-mini',
        env: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: 'https://api.openai.com/v1' },
        abortController: new AbortController(),
        effortLevel: 'high',
      },
    }));

    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', model: 'gpt-4o-mini' });
    expect(events[1]).toMatchObject({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
    });
    expect(events[2]).toMatchObject({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
    });
    expect(events[3]).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] },
    });
    expect(events[4]).toMatchObject({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'say hi' }],
      stream: true,
    });
  });

  it('Direct-API path: missing OPENAI_API_KEY and no factory → throws OPENAI_API_KEY_MISSING', async () => {
    process.env.USE_CODEX_DIRECT_API = '1';
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const adapter = new CodexAdapter();

    let caught = null;
    try {
      await collect(adapter.execute({
        prompt: 'hi',
        options: {
          model: 'gpt-4o-mini',
          env: {},
          abortController: new AbortController(),
        },
      }));
    } catch (e) {
      caught = e;
    }

    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;

    expect(caught).not.toBeNull();
    expect(caught.code).toBe('OPENAI_API_KEY_MISSING');
  });

  it('CLI path: command_execution and file_change events produce tool_result events', async () => {
    const fixturePathTool = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'codex', 'tool-call.jsonl');
    const lines = fs.readFileSync(fixturePathTool, 'utf-8').trim().split('\n').filter(Boolean);
    const fakeSpawn = vi.fn(() => createFakeChild({ stdoutLines: lines, exitCode: 0 }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    const events = await collect(adapter.execute({
      prompt: 'list files and create summary',
      options: { model: 'o4-mini', cwd: process.cwd(), env: {}, abortController: new AbortController() },
    }));

    const toolResults = events.filter((e) => e.type === 'tool_result');
    // Exact count: 2 command_executions + 1 file_change = 3 tool_result events
    expect(toolResults).toHaveLength(3);

    const cmdResults = toolResults.filter((e) => e.tool_name === 'command_execution');
    expect(cmdResults).toHaveLength(2);
    expect(cmdResults.some((r) => r.content.includes('file1.txt'))).toBe(true);

    const fileResult = toolResults.find((e) => e.tool_name === 'file_change');
    expect(fileResult).toBeDefined();
    expect(fileResult.content).toContain('summary.txt');
    expect(fileResult.content).toContain('add');
  });

  it('CLI path: reasoning events produce tool_result events', async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"codex-reason"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"r_0","type":"reasoning","text":"I need to check the files first."}}',
      '{"type":"item.completed","item":{"id":"msg_0","type":"agent_message","text":"Done checking."}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":10}}',
    ];
    const fakeSpawn = vi.fn(() => createFakeChild({ stdoutLines: lines, exitCode: 0 }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    const events = await collect(adapter.execute({
      prompt: 'check files',
      options: { model: 'gpt-5.2', cwd: process.cwd(), env: {}, abortController: new AbortController() },
    }));

    const reasoningResults = events.filter((e) => e.type === 'tool_result' && e.tool_name === 'reasoning');
    expect(reasoningResults).toHaveLength(1);
    expect(reasoningResults[0].content).toContain('check the files first');
  });

  it('CLI path: composed system prompt is passed through to stdin', async () => {
    const capture = { chunks: [], ended: false };
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-sys"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
      captureStdin: capture,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'do stuff',
      options: {
        model: 'gpt-4o',
        systemPrompt: 'You are helpful.\n\nPOST http://localhost:5000/api/sessions/test/canvas\nBody: {"filePath": "/path/to/file"}',
        cwd: process.cwd(),
        env: {},
        abortController: new AbortController(),
      },
    }));

    const joined = capture.chunks.join('');
    expect(joined).toContain('SYSTEM PROMPT:');
    expect(joined).toContain('POST http://localhost:5000/api/sessions/test/canvas');
    expect(joined).toContain('USER:');
    expect(joined).toContain('do stuff');
  });
});
