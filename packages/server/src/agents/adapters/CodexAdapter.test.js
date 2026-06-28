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

  it('CLI path: does not append native commit_attribution config', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-attr"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        commitAttributionOverride: 'Codex <noreply@openai.com>',
        abortController: new AbortController(),
      },
    }));

    const spawnArgs = fakeSpawn.mock.calls[0][0];
    expect(spawnArgs.args.some((arg) => arg.startsWith('commit_attribution='))).toBe(false);
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

  it('Direct-API path: ignores commitAttributionOverride without logging', async () => {
    process.env.USE_CODEX_DIRECT_API = '1';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    };
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => fakeStream),
        },
      },
    };

    const adapter = new CodexAdapter({ openaiClientFactory: () => client });
    const events = await collect(adapter.execute({
      prompt: 'say hi',
      options: {
        model: 'gpt-4o-mini',
        env: { OPENAI_API_KEY: 'sk-test' },
        commitAttributionOverride: 'Codex <noreply@openai.com>',
        abortController: new AbortController(),
      },
    }));

    expect(events.some((event) => event.type === 'result')).toBe(true);
    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
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

  it('CLI path: stdio MCP server becomes repeated -c mcp_servers.* args without type', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-stdio"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          projectServer: { command: 'node', args: ['project-server.js'] },
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    expect(args).toContain('mcp_servers.projectServer.command="node"');
    expect(args).toContain('mcp_servers.projectServer.args=["project-server.js"]');
    // Each value is preceded by -c
    const cmdIdx = args.indexOf('mcp_servers.projectServer.command="node"');
    expect(args[cmdIdx - 1]).toBe('-c');
    const argsIdx = args.indexOf('mcp_servers.projectServer.args=["project-server.js"]');
    expect(args[argsIdx - 1]).toBe('-c');
    // type is NOT emitted for stdio servers
    expect(args.some((a) => a.startsWith('mcp_servers.projectServer.type='))).toBe(false);
  });

  it('CLI path: stdio MCP server env values move into spawn env under original key names and are referenced via env_vars', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          myServer: { command: 'node', env: { API_KEY: 'secretvalue' } },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // command is present
    expect(args).toContain('mcp_servers.myServer.command="node"');
    // env_vars lists the original key name "API_KEY"
    expect(args).toContain('mcp_servers.myServer.env_vars=["API_KEY"]');
    // literal secret is NOT in argv
    expect(args.some((a) => a.includes('secretvalue'))).toBe(false);
    // secret is in spawn env under the original key name
    expect(env.API_KEY).toBe('secretvalue');
    // original session env is preserved
    expect(env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('CLI path: remote MCP server emits url, bearer_token_env_var, env_http_headers; omits type and literal credentials', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-remote"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          remoteServer: {
            type: 'sse',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer tok', 'X-Custom': 'hdr-value' },
          },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // url present
    expect(args).toContain('mcp_servers.remoteServer.url="https://example.com/mcp"');
    // Derive bearer_token_env_var name from arg
    const bearerArg = args.find((a) => a.startsWith('mcp_servers.remoteServer.bearer_token_env_var='));
    expect(bearerArg).toBeDefined();
    const bearerVarMatch = bearerArg.match(/"([^"]+)"$/);
    expect(bearerVarMatch).not.toBeNull();
    const bearerVarName = bearerVarMatch[1];
    expect(bearerVarName).toMatch(/^CIRCUSCHIEF_MCP_REMOTESERVER_BEARER_TOKEN_/);
    expect(env[bearerVarName]).toBe('tok');
    // Derive env_http_headers header var name from arg
    const headersArg = args.find((a) => a.startsWith('mcp_servers.remoteServer.env_http_headers='));
    expect(headersArg).toBeDefined();
    const headerVarMatch = headersArg.match(/X-Custom="([^"]+)"/);
    expect(headerVarMatch).not.toBeNull();
    const headerVarName = headerVarMatch[1];
    expect(headerVarName).toMatch(/^CIRCUSCHIEF_MCP_REMOTESERVER_HDR_X_CUSTOM_/);
    expect(env[headerVarName]).toBe('hdr-value');
    // type NOT emitted
    expect(args.some((a) => a.startsWith('mcp_servers.remoteServer.type='))).toBe(false);
    // literal credential values NOT in argv (check for TOML-quoted literals)
    expect(args.some((a) => a.includes('"tok"'))).toBe(false);
    expect(args.some((a) => a.includes('Bearer tok'))).toBe(false);
    expect(args.some((a) => a.includes('"hdr-value"'))).toBe(false);
    // original API key still present in spawn env
    expect(env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('CLI path: malformed stdio MCP server (missing command) produces no MCP args', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-bad-stdio"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          badServer: { args: ['server.js'] }, // missing command
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    expect(args.some((a) => a.startsWith('mcp_servers.badServer.'))).toBe(false);
  });

  it('CLI path: malformed remote MCP server (missing url) produces no MCP args', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-bad-remote"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          badRemote: { type: 'sse', headers: { Authorization: 'Bearer tok' } }, // missing url
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    expect(args.some((a) => a.startsWith('mcp_servers.badRemote.'))).toBe(false);
  });

  it('CLI path: MCP config composes with reasoning and auth -c args', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-compose"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: {},  // no API key → ChatGPT auth
        abortController: new AbortController(),
        effortLevel: 'high',
        mcpServers: {
          projectServer: { command: 'node', args: ['server.js'] },
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    // Reasoning config
    expect(args).toContain('model_reasoning_effort=high');
    expect(args).toContain('plan_mode_reasoning_effort=high');
    // MCP config
    expect(args.some((a) => a.startsWith('mcp_servers.projectServer.'))).toBe(true);
    // Auth config
    expect(args).toContain('preferred_auth_method=chatgpt');
  });

  it('CLI path: server name with unsafe TOML chars is quoted in -c key', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-quote"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          'my.server': { command: 'node', args: [] },
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    // "my.server" is not a bare TOML key — it must be quoted
    expect(args.some((a) => a.startsWith('mcp_servers."my.server".'))).toBe(true);
  });

  it('CLI path: non-Bearer Authorization header goes into env_http_headers, not bearer_token_env_var', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-basic-auth"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          basicServer: {
            type: 'sse',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Basic dXNlcjpwYXNz' },
          },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // bearer_token_env_var should NOT be emitted for Basic auth
    expect(args.some((a) => a.startsWith('mcp_servers.basicServer.bearer_token_env_var='))).toBe(false);
    // Authorization header should be in env_http_headers
    const headersArg = args.find((a) => a.startsWith('mcp_servers.basicServer.env_http_headers='));
    expect(headersArg).toBeDefined();
    expect(headersArg).toMatch(/Authorization=/);
    // Derive the env var name from the arg and verify the value is in env
    const authVarMatch = headersArg.match(/Authorization="([^"]+)"/);
    expect(authVarMatch).not.toBeNull();
    const authVarName = authVarMatch[1];
    expect(env[authVarName]).toBe('Basic dXNlcjpwYXNz');
    // Literal credential NOT in argv
    expect(args.some((a) => a.includes('dXNlcjpwYXNz'))).toBe(false);
  });

  it('CLI path: colliding sanitized remote header names get distinct env var names', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-hdr-collide"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    // 'X-Custom' and 'X.Custom' both sanitize to 'X_CUSTOM' — hash must distinguish them
    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          srv: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { 'X-Custom': 'val-dash', 'X.Custom': 'val-dot' },
          },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // Both header values should be in the spawn env under distinct variable names
    const mcpEnvVars = Object.keys(env).filter((k) => k.startsWith('CIRCUSCHIEF_MCP_'));
    expect(mcpEnvVars).toHaveLength(2);
    expect(mcpEnvVars[0]).not.toBe(mcpEnvVars[1]);
    // Both values are present
    expect(Object.values(env).filter((v) => v === 'val-dash')).toHaveLength(1);
    expect(Object.values(env).filter((v) => v === 'val-dot')).toHaveLength(1);
    // Neither literal value in argv
    expect(args.some((a) => a.includes('val-dash'))).toBe(false);
    expect(args.some((a) => a.includes('val-dot'))).toBe(false);
  });

  it('CLI path: distinct stdio env keys each appear in env and env_vars under their original names', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env-keys"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          envSrv: {
            command: 'node',
            env: { 'api-key': 'val-dash', API_KEY: 'val-upper' },
          },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // Both original key names are present in spawn env with their respective values
    expect(env['api-key']).toBe('val-dash');
    expect(env.API_KEY).toBe('val-upper');
    // Both key names appear in env_vars
    const envVarsArg = args.find((a) => a.startsWith('mcp_servers.envSrv.env_vars='));
    expect(envVarsArg).toBeDefined();
    expect(envVarsArg).toContain('"api-key"');
    expect(envVarsArg).toContain('"API_KEY"');
    // Neither literal value in argv
    expect(args.some((a) => a.includes('val-dash'))).toBe(false);
    expect(args.some((a) => a.includes('val-upper'))).toBe(false);
  });

  it('CLI path: bearer token with trailing whitespace is trimmed before storing in env', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-bearer-trim"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          trimServer: {
            type: 'sse',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer tok123   ' },
          },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    const bearerArg = args.find((a) => a.startsWith('mcp_servers.trimServer.bearer_token_env_var='));
    expect(bearerArg).toBeDefined();
    const bearerVarMatch = bearerArg.match(/"([^"]+)"$/);
    expect(bearerVarMatch).not.toBeNull();
    const bearerVarName = bearerVarMatch[1];
    // Token stored in env must be trimmed
    expect(env[bearerVarName]).toBe('tok123');
  });

  it('CLI path: Bearer header with only whitespace after Bearer is not treated as bearer token', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-bearer-empty"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          emptyBearer: {
            type: 'sse',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer   ' },
          },
        },
      },
    }));

    const { args } = fakeSpawn.mock.calls[0][0];
    // bearer_token_env_var should NOT be emitted for an empty token
    expect(args.some((a) => a.startsWith('mcp_servers.emptyBearer.bearer_token_env_var='))).toBe(false);
    // The Authorization header should fall through to env_http_headers
    expect(args.some((a) => a.startsWith('mcp_servers.emptyBearer.env_http_headers='))).toBe(true);
  });

  it('CLI path: stdio MCP env key colliding with base env PATH is blocked — base value preserved, key absent from env_vars and argv', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env-block-path"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test', PATH: 'base-path' },
        abortController: new AbortController(),
        mcpServers: {
          pathServer: { command: 'node', env: { PATH: 'mcp-path' } },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // Base PATH must be preserved
    expect(env.PATH).toBe('base-path');
    // MCP PATH value must not be injected
    expect(env.PATH).not.toBe('mcp-path');
    // env_vars must not include PATH
    const envVarsArg = args.find((a) => a.startsWith('mcp_servers.pathServer.env_vars='));
    expect(envVarsArg).toBeUndefined();
    // MCP literal value must not appear in argv
    expect(args.some((a) => a.includes('mcp-path'))).toBe(false);
    // A warning should have been logged
    expect(warnSpy).toHaveBeenCalledWith(
      '[CodexAdapter] dropped MCP stdio env keys that would override Codex env:',
      expect.objectContaining({ serverName: 'pathServer', keys: expect.arrayContaining(['PATH']) }),
    );
    warnSpy.mockRestore();
  });

  it('CLI path: stdio MCP env key OPENAI_API_KEY is blocked even when absent from base env — reserved name protection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env-block-key"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        // No OPENAI_API_KEY in base env → ChatGPT auth mode
        env: { HOME: '/tmp' },
        abortController: new AbortController(),
        mcpServers: {
          sneakyServer: { command: 'node', env: { OPENAI_API_KEY: 'mcp-key' } },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // OPENAI_API_KEY must not be injected from MCP server
    expect(env.OPENAI_API_KEY).toBeUndefined();
    // env_vars must not include OPENAI_API_KEY
    const envVarsArg = args.find((a) => a.startsWith('mcp_servers.sneakyServer.env_vars='));
    expect(envVarsArg).toBeUndefined();
    // ChatGPT auth must still be emitted (no API key present)
    expect(args).toContain('preferred_auth_method=chatgpt');
    // Warning should have been logged
    expect(warnSpy).toHaveBeenCalledWith(
      '[CodexAdapter] dropped MCP stdio env keys that would override Codex env:',
      expect.objectContaining({ serverName: 'sneakyServer', keys: expect.arrayContaining(['OPENAI_API_KEY']) }),
    );
    warnSpy.mockRestore();
  });

  it('CLI path: new stdio MCP env key API_KEY is injected and listed in env_vars', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env-new-key"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_outputs":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test' },
        abortController: new AbortController(),
        mcpServers: {
          apiServer: { command: 'node', env: { API_KEY: 'my-secret' } },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // API_KEY is new — it must be injected into spawn env
    expect(env.API_KEY).toBe('my-secret');
    // env_vars must list API_KEY
    const envVarsArg = args.find((a) => a.startsWith('mcp_servers.apiServer.env_vars='));
    expect(envVarsArg).toBeDefined();
    expect(envVarsArg).toContain('"API_KEY"');
    // Literal value must NOT appear in argv
    expect(args.some((a) => a.includes('my-secret'))).toBe(false);
    // No warning for accepted keys
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('CLI path: mixed stdio MCP env keys — blocked PATH dropped, new API_KEY accepted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-env-mixed"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    await collect(adapter.execute({
      prompt: 'hi',
      options: {
        model: 'gpt-4o',
        cwd: process.cwd(),
        env: { OPENAI_API_KEY: 'sk-test', PATH: '/usr/bin' },
        abortController: new AbortController(),
        mcpServers: {
          mixedServer: { command: 'node', env: { PATH: 'bad', API_KEY: 'ok' } },
        },
      },
    }));

    const { args, env } = fakeSpawn.mock.calls[0][0];
    // PATH blocked — base value preserved
    expect(env.PATH).toBe('/usr/bin');
    // API_KEY accepted
    expect(env.API_KEY).toBe('ok');
    // env_vars must contain only API_KEY
    const envVarsArg = args.find((a) => a.startsWith('mcp_servers.mixedServer.env_vars='));
    expect(envVarsArg).toBeDefined();
    expect(envVarsArg).toContain('"API_KEY"');
    expect(envVarsArg).not.toContain('"PATH"');
    // Warning for dropped PATH
    expect(warnSpy).toHaveBeenCalledWith(
      '[CodexAdapter] dropped MCP stdio env keys that would override Codex env:',
      expect.objectContaining({ serverName: 'mixedServer', keys: expect.arrayContaining(['PATH']) }),
    );
    warnSpy.mockRestore();
  });

  it('CLI path: non-finite startup_timeout_sec is omitted from argv', async () => {
    const fakeSpawn = vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-mcp-timeout-nan"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));
    const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });

    for (const badTimeout of [NaN, Infinity, -Infinity]) {
      fakeSpawn.mockClear();
      await collect(adapter.execute({
        prompt: 'hi',
        options: {
          model: 'gpt-4o',
          cwd: process.cwd(),
          env: { OPENAI_API_KEY: 'sk-test' },
          abortController: new AbortController(),
          mcpServers: {
            timeoutSrv: { command: 'node', startup_timeout_sec: badTimeout },
          },
        },
      }));

      const { args } = fakeSpawn.mock.calls[0][0];
      expect(args.some((a) => a.startsWith('mcp_servers.timeoutSrv.startup_timeout_sec='))).toBe(false);
    }
  });

  it('CLI path: type:"http" and type:"sse" remote servers serialize to the same url-based Codex config shape', async () => {
    const makeSpawn = () => vi.fn(() => createFakeChild({
      stdoutLines: ['{"type":"thread.started","thread_id":"codex-type-compat"}', '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'],
      exitCode: 0,
    }));

    const executeWithType = async (serverType) => {
      const fakeSpawn = makeSpawn();
      const adapter = new CodexAdapter({ spawnCodexProcess: fakeSpawn });
      await collect(adapter.execute({
        prompt: 'hi',
        options: {
          model: 'gpt-4o',
          cwd: process.cwd(),
          env: { OPENAI_API_KEY: 'sk-test' },
          abortController: new AbortController(),
          mcpServers: { srv: { type: serverType, url: 'https://x.test/mcp' } },
        },
      }));
      return fakeSpawn.mock.calls[0][0].args;
    };

    const httpArgs = await executeWithType('http');
    const sseArgs = await executeWithType('sse');

    // Both emit url
    expect(httpArgs).toContain('mcp_servers.srv.url="https://x.test/mcp"');
    expect(sseArgs).toContain('mcp_servers.srv.url="https://x.test/mcp"');
    // Neither emits type
    expect(httpArgs.some((a) => a.startsWith('mcp_servers.srv.type='))).toBe(false);
    expect(sseArgs.some((a) => a.startsWith('mcp_servers.srv.type='))).toBe(false);
  });
});
