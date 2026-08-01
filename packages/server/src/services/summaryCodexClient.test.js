import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import {
  buildCodexSummaryArgs, buildCodexSummaryEnv, callCodexSummary,
} from './summaryCodexClient.js';

function successfulChild() {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
  process.nextTick(() => child.emit('exit', 0));
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
    const env = buildCodexSummaryEnv({ PATH: '/bin', CODEX_HOME: '/codex', OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'x', PROVIDER_TOKEN: 'secret' });
    expect(env).toMatchObject({ PATH: '/bin', CODEX_HOME: '/codex' });
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
});
