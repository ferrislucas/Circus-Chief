import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import {
  buildCodexSummaryArgs, buildCodexSummaryEnv, callCodexSummary, CODEX_SUMMARY_TIMEOUT_MS,
} from './summaryCodexClient.js';

function successfulChild() {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => child.emit('exit', 0));
  return child;
}

function streamingChild({ exitCode = 0, stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let stdoutDrained = false;
  let stderrDrained = false;
  const originalStdoutOn = child.stdout.on.bind(child.stdout);
  const originalStderrOn = child.stderr.on.bind(child.stderr);
  child.stdout.on = (event, listener) => {
    if (event === 'data') stdoutDrained = true;
    return originalStdoutOn(event, listener);
  };
  child.stderr.on = (event, listener) => {
    if (event === 'data') stderrDrained = true;
    return originalStderrOn(event, listener);
  };
  process.nextTick(() => {
    for (let index = 0; index < 300; index += 1) child.stdout.emit('data', Buffer.alloc(1024));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('exit', exitCode);
  });
  child.didDrain = () => ({ stdoutDrained, stderrDrained });
  return child;
}

describe('summaryCodexClient', () => {
  it('builds a non-interactive, read-only Codex invocation', () => {
    const args = buildCodexSummaryArgs({ model: 'gpt-5.4-mini', schemaPath: '/tmp/schema', outputPath: '/tmp/output' });
    expect(args).toEqual(expect.arrayContaining([
      'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only', '-m', 'gpt-5.4-mini', '--output-schema', '/tmp/schema',
      '--output-last-message', '/tmp/output', '-c', 'preferred_auth_method=chatgpt',
    ]));
    expect(args).not.toContain('resume');
  });

  it('removes API and provider credentials while preserving Codex auth context', () => {
    const env = buildCodexSummaryEnv({ PATH: '/bin', CODEX_HOME: '/codex', OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'x', PROVIDER_TOKEN: 'secret', GITHUB_TOKEN: 'keep-me' });
    expect(env).toMatchObject({ PATH: '/bin', CODEX_HOME: '/codex', GITHUB_TOKEN: 'keep-me' });
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('OPENAI_BASE_URL');
    expect(env).not.toHaveProperty('PROVIDER_TOKEN');
  });

  it('returns only the structured final message and cleans its isolated directory', async () => {
    const fs = {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/isolated'),
      writeFile: vi.fn().mockResolvedValue(),
      readFile: vi.fn().mockResolvedValue('{"short_summary":"ok"}'),
      rm: vi.fn().mockResolvedValue(),
    };
    const spawn = vi.fn(() => successfulChild());
    const result = await callCodexSummary({ prompt: 'conversation', systemPrompt: 'system', model: 'gpt-5.4-mini', jsonSchema: {} }, { fs, spawn, env: { PATH: '/bin', OPENAI_API_KEY: 'secret' } });
    expect(result).toBe('{"short_summary":"ok"}');
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/isolated', env: expect.not.objectContaining({ OPENAI_API_KEY: expect.anything() }) }));
    expect(fs.rm).toHaveBeenCalledWith('/tmp/isolated', { recursive: true, force: true });
  });

  it('rejects unsupported models before spawning', async () => {
    const spawn = vi.fn();
    await expect(callCodexSummary({ prompt: 'x', model: 'not-supported', jsonSchema: {} }, { spawn })).rejects.toMatchObject({ code: 'CODEX_SUMMARY_UNSUPPORTED_MODEL' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects catalog models which Codex cannot use before spawning', async () => {
    const spawn = vi.fn();
    await expect(callCodexSummary({ prompt: 'x', model: 'gpt-5.5', jsonSchema: {} }, { spawn })).rejects.toMatchObject({ code: 'CODEX_SUMMARY_UNSUPPORTED_MODEL' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('drains large stdout and stderr streams before the child exits', async () => {
    const fs = { mkdtemp: vi.fn().mockResolvedValue('/tmp/isolated'), writeFile: vi.fn(), readFile: vi.fn().mockResolvedValue('{}'), rm: vi.fn().mockResolvedValue() };
    const child = streamingChild({ stderr: 'ordinary diagnostic' });
    await callCodexSummary({ prompt: 'x', model: 'gpt-5.4-mini', jsonSchema: {} }, { fs, spawn: vi.fn(() => child) });
    expect(child.didDrain()).toEqual({ stdoutDrained: true, stderrDrained: true });
  });

  it('classifies streamed authentication failures without exposing stderr', async () => {
    const fs = { mkdtemp: vi.fn().mockResolvedValue('/tmp/isolated'), writeFile: vi.fn(), readFile: vi.fn(), rm: vi.fn().mockResolvedValue() };
    const child = streamingChild({ exitCode: 1, stderr: 'Not logged in. Please run codex login.' });
    await expect(callCodexSummary({ prompt: 'x', model: 'gpt-5.4-mini', jsonSchema: {} }, { fs, spawn: vi.fn(() => child) }))
      .rejects.toMatchObject({ code: 'CODEX_SUMMARY_AUTHENTICATION', publicMessage: 'Codex is not authenticated. Run `codex login` and try again.' });
  });

  it('keeps generic non-zero exits distinct after streamed stderr', async () => {
    const fs = { mkdtemp: vi.fn().mockResolvedValue('/tmp/isolated'), writeFile: vi.fn(), readFile: vi.fn(), rm: vi.fn().mockResolvedValue() };
    await expect(callCodexSummary({ prompt: 'x', model: 'gpt-5.4-mini', jsonSchema: {} }, { fs, spawn: vi.fn(() => streamingChild({ exitCode: 1, stderr: 'unexpected failure' })) }))
      .rejects.toMatchObject({ code: 'CODEX_SUMMARY_NON_ZERO_EXIT' });
  });

  it('uses a reasoning-safe default timeout and honors an override', async () => {
    expect(CODEX_SUMMARY_TIMEOUT_MS).toBe(180_000);
    const timerSpy = vi.spyOn(global, 'setTimeout');
    const fs = { mkdtemp: vi.fn().mockResolvedValue('/tmp/isolated'), writeFile: vi.fn(), readFile: vi.fn().mockResolvedValue('{}'), rm: vi.fn().mockResolvedValue() };
    await callCodexSummary({ prompt: 'x', model: 'gpt-5.4-mini', jsonSchema: {}, timeoutMs: 12_345 }, { fs, spawn: vi.fn(successfulChild) });
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 12_345);
    timerSpy.mockRestore();
  });
});
