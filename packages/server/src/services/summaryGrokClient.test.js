import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildGrokSummaryArgs, buildGrokSummaryEnv, callGrokSummary, extractGrokSummaryText,
} from './summaryGrokClient.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';

function childWith({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('exit', exitCode);
  });
  return child;
}

function fakeFs() {
  return {
    mkdtemp: vi.fn().mockResolvedValue('/tmp/grok-summary'),
    writeFile: vi.fn().mockResolvedValue(),
    rm: vi.fn().mockResolvedValue(),
  };
}

describe('summaryGrokClient', () => {
  it('builds a one-shot read-only invocation and drops provider API keys', () => {
    const args = buildGrokSummaryArgs({
      model: 'grok-4.7-build-fast',
      schema: { type: 'object' },
      promptFile: '/tmp/prompt.txt',
      cwd: '/tmp/grok-summary',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--prompt-file', '/tmp/prompt.txt',
      '--cwd', '/tmp/grok-summary',
      '-m', 'grok-4.7-build-fast',
      '--output-format', 'json',
      '--json-schema', '{"type":"object"}',
      '--max-turns', '1',
      '--sandbox', 'read-only',
      '--permission-mode', 'dontAsk',
    ]));
    const env = buildGrokSummaryEnv({ PATH: '/bin', XAI_API_KEY: 'secret', OPENAI_API_KEY: 'secret', HOME: '/users/me' });
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/users/me' });
    expect(env).not.toHaveProperty('XAI_API_KEY');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('returns structured output from the headless JSON object', () => {
    expect(extractGrokSummaryText(JSON.stringify({
      text: 'prose',
      structured_output: { short_summary: 'ok' },
      stopReason: 'end_turn',
    }))).toBe('{"short_summary":"ok"}');
    expect(extractGrokSummaryText(JSON.stringify({
      text: '{"short_summary":"from text"}',
      stopReason: 'end_turn',
    }))).toBe('{"short_summary":"from text"}');
  });

  it('returns the summary text and scrubs the child environment', async () => {
    const fs = fakeFs();
    const spawn = vi.fn(() => childWith({ stdout: JSON.stringify({ text: '{"short_summary":"ok"}', stopReason: 'end_turn' }) }));
    const result = await callGrokSummary(
      { prompt: 'conversation', systemPrompt: 'system', model: 'grok-4.7-build-fast', jsonSchema: { type: 'object' } },
      { fs, spawn, env: { PATH: '/bin', XAI_API_KEY: 'secret' } },
    );
    expect(result).toBe('{"short_summary":"ok"}');
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      command: 'grok',
      cwd: '/tmp/grok-summary',
      env: expect.not.objectContaining({ XAI_API_KEY: expect.anything() }),
      args: expect.arrayContaining(['-m', 'grok-4.7-build-fast']),
    }));
    expect(fs.rm).toHaveBeenCalledWith('/tmp/grok-summary', { recursive: true, force: true });
  });

  it('classifies authentication failures without exposing stderr', async () => {
    const fs = fakeFs();
    await expect(callGrokSummary(
      { prompt: 'x', model: 'grok-4.7-build-fast', jsonSchema: {} },
      { fs, spawn: vi.fn(() => childWith({ exitCode: 1, stderr: 'Not logged in. Run grok login.' })) },
    )).rejects.toMatchObject({
      code: 'GROK_SUMMARY_AUTHENTICATION',
      publicMessage: 'Grok is not authenticated. Run `grok login` and try again.',
    });
  });

  it('keeps a usage-limit sentence on reason and leaves the public message generic', async () => {
    const fs = fakeFs();
    const stdout = `${JSON.stringify({ type: 'error', message: "Usage limit reached. token=sk-grok-secret" })}\n`;
    const error = await callGrokSummary(
      { prompt: 'x', model: 'grok-4.7-build-fast', jsonSchema: {} },
      { fs, spawn: vi.fn(() => childWith({ exitCode: 1, stdout })) },
    ).catch((err) => err);

    expect(error).toMatchObject({
      code: 'GROK_SUMMARY_NON_ZERO_EXIT',
      publicMessage: 'Grok could not generate a summary. Please try again.',
    });
    expect(error.message).not.toContain('Usage limit');
    expect(error.reason).toContain('Usage limit');
    expect(error.reason).not.toContain('sk-grok-secret');
    expect(matchesStartFailoverEligibleError(error)).toBe(true);
  });

  it('does not treat a generic non-zero exit as failover-eligible', async () => {
    const fs = fakeFs();
    const error = await callGrokSummary(
      { prompt: 'x', model: 'grok-4.7-build-fast', jsonSchema: {} },
      { fs, spawn: vi.fn(() => childWith({ exitCode: 1, stderr: 'unexpected failure' })) },
    ).catch((err) => err);

    expect(error.code).toBe('GROK_SUMMARY_NON_ZERO_EXIT');
    expect(error.reason).toBeUndefined();
    expect(matchesStartFailoverEligibleError(error)).toBe(false);
  });
});
