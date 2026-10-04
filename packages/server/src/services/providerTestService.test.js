import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * We mock the `@anthropic-ai/sdk` and `openai` packages at module scope. Each
 * test swaps the behavior of the mocked client methods via the exposed refs.
 */
const anthropicCreateSpy = vi.fn();
const openaiListSpy = vi.fn();
const openaiChatCreateSpy = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic() {
    return { messages: { create: anthropicCreateSpy } };
  }
  return { default: MockAnthropic };
});

vi.mock('openai', () => {
  function MockOpenAI() {
    return {
      models: { list: openaiListSpy },
      chat: { completions: { create: openaiChatCreateSpy } },
    };
  }
  return { default: MockOpenAI };
});

import { testProviderConnection, buildMuseTestArgs } from './providerTestService.js';

function createMockGeminiChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/**
 * Minimal owned `muse exec --json` transcript for the meta probe: an
 * accepted command, its linked run, and the completed success terminal the
 * probe requires (FR-4 doctrine — exit 0 alone is not success).
 */
function museProbeCompletedOutput() {
  const line = (sequence, payload_type, payload) => JSON.stringify({
    schema_version: 1, record_type: 'event', sequence, payload_type, payload,
  });
  return [
    line(1, 'runtime.command.accepted', { command_id: 'cmd-probe' }),
    line(2, 'session.run.linked', { command_id: 'cmd-probe', run_stream: { id: 'run-probe' } }),
    line(3, 'run.terminal.completed', { command_id: 'cmd-probe', run_stream: { id: 'run-probe' }, terminal: 'completed', text: 'Hi!' }),
  ].join('\n');
}

function apiError({ status, code, type, message }) {
  const err = new Error(message || 'API error');
  if (status !== undefined) err.status = status;
  if (code !== undefined) err.code = code;
  if (type !== undefined) err.type = type;
  return err;
}

describe('providerTestService', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Anthropic kind (regression) ───────────────────────────────────────

  describe("kind='anthropic' (regression)", () => {
    it('success → { success: true, message, details: { model, usage } }', async () => {
      anthropicCreateSpy.mockResolvedValue({
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      const result = await testProviderConnection({
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        authToken: 'sk-ant',
        apiTimeoutMs: 30000,
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      expect(result.details.model).toBe('claude-sonnet-4-20250514');
      expect(result.details.usage).toEqual({ input_tokens: 1, output_tokens: 1 });
      expect(anthropicCreateSpy).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-sonnet-5',
      }));
    });

    it('401 → auth failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ status: 401, type: 'authentication_error' }));
      const result = await testProviderConnection({ kind: 'anthropic', authToken: 'bad' });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'authentication_error' },
      });
    });

    it('404 → model failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ status: 404, type: 'not_found_error' }));
      const result = await testProviderConnection({ kind: 'anthropic' });
      expect(result).toEqual({
        success: false,
        message: 'Model not found. Check the model ID.',
        details: { code: 404, type: 'not_found_error' },
      });
    });

    it('ECONNREFUSED → base URL failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ code: 'ECONNREFUSED' }));
      const result = await testProviderConnection({ kind: 'anthropic' });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not connect to server. Check the base URL.');
      expect(result.details.code).toBe('ECONNREFUSED');
    });

    it('ETIMEDOUT → timeout failure shape', async () => {
      anthropicCreateSpy.mockRejectedValue(apiError({ code: 'ETIMEDOUT' }));
      const result = await testProviderConnection({ kind: 'anthropic', apiTimeoutMs: 1000 });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection timed out. Try increasing the timeout.');
      expect(result.details.code).toBe('ETIMEDOUT');
    });

    it('default behavior when kind is omitted → anthropic path', async () => {
      anthropicCreateSpy.mockResolvedValue({ model: 'x', usage: {} });
      const result = await testProviderConnection({ authToken: 'sk' });
      expect(result.success).toBe(true);
      expect(anthropicCreateSpy).toHaveBeenCalledTimes(1);
      expect(openaiListSpy).not.toHaveBeenCalled();
    });
  });

  // ── OpenAI kind ───────────────────────────────────────────────────────

  describe("kind='openai'", () => {
    it('success via models.list() → { success: true, message, details.model }', async () => {
      openaiListSpy.mockResolvedValue({
        data: [{ id: 'gpt-4o' }, { id: 'o1-mini' }],
      });
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-test',
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      expect(result.details.model).toBe('gpt-4o');
      // Fallback should not be triggered on success
      expect(openaiChatCreateSpy).not.toHaveBeenCalled();
    });

    it('models.list() 404 → falls back to chat.completions.create with max_tokens=1', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 404 }));
      openaiChatCreateSpy.mockResolvedValue({
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://chat-only.local/v1',
        authToken: 'sk',
      });
      expect(result.success).toBe(true);
      expect(result.details.model).toBe('gpt-4o-mini');
      expect(result.details.usage).toEqual({ prompt_tokens: 1, completion_tokens: 1 });
      expect(openaiChatCreateSpy).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    });

    it('401 on models.list() → auth failure shape (no fallback)', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 401, type: 'invalid_api_key' }));
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'bad',
      });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'invalid_api_key' },
      });
      expect(openaiChatCreateSpy).not.toHaveBeenCalled();
    });

    it('ECONNREFUSED on models.list() → base URL failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ code: 'ECONNREFUSED' }));
      const result = await testProviderConnection({
        kind: 'openai',
        baseUrl: 'https://nowhere.local',
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not connect to server. Check the base URL.');
      expect(result.details.code).toBe('ECONNREFUSED');
    });

    it('ETIMEDOUT on models.list() → timeout failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ code: 'ETIMEDOUT' }));
      const result = await testProviderConnection({
        kind: 'openai',
        apiTimeoutMs: 500,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection timed out. Try increasing the timeout.');
      expect(result.details.code).toBe('ETIMEDOUT');
    });

    it('models.list 404 then chat.completions 401 → auth failure shape', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 404 }));
      openaiChatCreateSpy.mockRejectedValue(apiError({ status: 401, type: 'invalid_api_key' }));
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'bad',
      });
      expect(result).toEqual({
        success: false,
        message: 'Authentication failed. Check your auth token.',
        details: { code: 401, type: 'invalid_api_key' },
      });
    });

    it('empty list + no defaultSonnetModel → success with empty details', async () => {
      openaiListSpy.mockResolvedValue({ data: [] });
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'sk',
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
      // details.model is absent when no model could be resolved
      expect(result.details.model).toBeUndefined();
    });

    it('empty list but defaultSonnetModel supplied → echoes that model', async () => {
      openaiListSpy.mockResolvedValue({ data: [] });
      const result = await testProviderConnection({
        kind: 'openai',
        authToken: 'sk',
        defaultSonnetModel: 'custom-model-id',
      });
      expect(result.success).toBe(true);
      expect(result.details.model).toBe('custom-model-id');
    });

    it('response shape always includes { success, message, details }', async () => {
      openaiListSpy.mockRejectedValue(apiError({ status: 500, type: 'server_error', message: 'boom' }));
      const result = await testProviderConnection({ kind: 'openai' });
      expect(Object.keys(result).sort()).toEqual(['details', 'message', 'success']);
      expect(result.success).toBe(false);
      expect(result.details.code).toBe(500);
      expect(result.details.type).toBe('server_error');
    });
  });

  // ── Google/Gemini kind ────────────────────────────────────────────────

  describe("kind='google'", () => {
    it('success uses injected Gemini spawner with trust, approval mode, API key, and cwd', async () => {
      const child = createMockGeminiChild();
      const spawnGeminiProcess = vi.fn(() => child);

      const promise = testProviderConnection({
        kind: 'google',
        authToken: 'gemini-key',
        workingDirectory: '/tmp/gemini-workdir',
      }, { spawnGeminiProcess });

      child.emit('exit', 0);
      const result = await promise;

      expect(result).toEqual({
        success: true,
        message: 'Connection successful',
        details: { model: 'gemini-2.5-flash' },
      });
      expect(spawnGeminiProcess).toHaveBeenCalledWith({
        command: 'gemini',
        args: ['-p', 'Hi', '--output-format', 'json', '--skip-trust', '--approval-mode=auto_edit', '-m', 'gemini-2.5-flash'],
        cwd: '/tmp/gemini-workdir',
        env: { GEMINI_API_KEY: 'gemini-key' },
      });
    });

    it('non-zero exit maps stderr into failure shape', async () => {
      const child = createMockGeminiChild();
      const spawnGeminiProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'google' }, { spawnGeminiProcess });

      child.stderr.emit('data', Buffer.from('bad auth\n'));
      child.emit('exit', 1);
      const result = await promise;

      expect(result).toEqual({
        success: false,
        message: 'bad auth',
        details: { code: undefined, type: 'Error' },
      });
    });

    it('ENOENT maps to install-help failure message', async () => {
      const child = createMockGeminiChild();
      const spawnGeminiProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'google' }, { spawnGeminiProcess });
      const error = new Error('spawn gemini ENOENT');
      error.code = 'ENOENT';
      child.emit('error', error);
      const result = await promise;

      expect(result).toEqual({
        success: false,
        message: 'Gemini CLI not found. Install via: npm install -g @google/gemini-cli',
        details: { code: undefined, type: 'Error' },
      });
    });

    it('timeout kills the process and returns failure shape', async () => {
      vi.useFakeTimers();
      const child = createMockGeminiChild();
      const spawnGeminiProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'google', apiTimeoutMs: 25 }, { spawnGeminiProcess });
      await vi.advanceTimersByTimeAsync(25);
      const result = await promise;

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toEqual({
        success: false,
        message: 'Gemini CLI timed out after 25ms',
        details: { code: undefined, type: 'Error' },
      });
      vi.useRealTimers();
    });
  });

  // ── Meta/Muse kind ────────────────────────────────────────────────────

  describe("kind='meta'", () => {
    it('success spawns headless muse exec with the configured model', async () => {
      const savedMuseBin = process.env.MUSE_BIN;
      delete process.env.MUSE_BIN;
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({
        kind: 'meta',
        workingDirectory: '/tmp/muse-workdir',
        defaultSonnetModel: 'muse-spark-1.3-contributor',
      }, { spawnMuseProcess });

      child.stdout.emit('data', Buffer.from(`${museProbeCompletedOutput()}\n`));
      child.emit('exit', 0);
      const result = await promise;

      expect(result).toEqual({
        success: true,
        message: 'Connection successful',
        details: { model: 'muse-spark-1.3-contributor' },
      });
      expect(spawnMuseProcess).toHaveBeenCalledWith({
        command: 'muse',
        args: ['exec', '--json', '--no-session-log', '--workspace', '/tmp/muse-workdir', '--model', 'muse-spark-1.3-contributor', 'Hi'],
        cwd: '/tmp/muse-workdir',
        env: process.env,
      });
      if (savedMuseBin === undefined) delete process.env.MUSE_BIN;
      else process.env.MUSE_BIN = savedMuseBin;
    });

    it('errors out when no working directory is set (never server-cwd fallback)', async () => {
      const spawnMuseProcess = vi.fn(() => createMockGeminiChild());

      const result = await testProviderConnection({
        kind: 'meta',
        defaultSonnetModel: 'muse-spark-1.3',
      }, { spawnMuseProcess });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/working directory/i);
      expect(result.details?.code).toBe('MISSING_WORKING_DIRECTORY');
      expect(spawnMuseProcess).not.toHaveBeenCalled();
    });

    it('buildMuseTestArgs builds the headless exec argv from the configured model', () => {
      expect(buildMuseTestArgs({
        workingDirectory: '/tmp/w',
        defaultSonnetModel: 'muse-spark-1.3-contributor',
      })).toEqual({
        command: 'muse',
        args: ['exec', '--json', '--no-session-log', '--workspace', '/tmp/w', '--model', 'muse-spark-1.3-contributor', 'Hi'],
        cwd: '/tmp/w',
        model: 'muse-spark-1.3-contributor',
      });
    });

    it('buildMuseTestArgs throws when the working directory is unset', () => {
      expect(() => buildMuseTestArgs({ defaultSonnetModel: 'muse-spark-1.3' }))
        .toThrow(expect.objectContaining({ code: 'MISSING_WORKING_DIRECTORY' }));
    });

    // Finding #9: the 'muse-spark-1.3' fallback is last-resort-only for a
    // model-less provider. The connection test is one minimal BILLED exec
    // turn, so an explicitly configured model is always preferred.
    it('buildMuseTestArgs falls back to muse-spark-1.3 only when no model is configured', () => {
      expect(buildMuseTestArgs({ workingDirectory: '/tmp/w' })).toEqual({
        command: 'muse',
        args: ['exec', '--json', '--no-session-log', '--workspace', '/tmp/w', '--model', 'muse-spark-1.3', 'Hi'],
        cwd: '/tmp/w',
        model: 'muse-spark-1.3',
      });
    });

    it('non-zero exit maps stderr into failure shape', async () => {
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'meta', workingDirectory: '/tmp/muse-workdir' }, { spawnMuseProcess });

      child.stderr.emit('data', Buffer.from('auth required\n'));
      child.emit('exit', 1);
      const result = await promise;

      expect(result).toEqual({
        success: false,
        message: 'auth required',
        details: { code: undefined, type: 'Error' },
      });
    });

    // Finding #5: probe stderr retention must be bounded like the other
    // transports (16 KiB) — a chatty child must not grow memory without
    // limit through the failure message.
    it('bounds retained probe stderr on a chatty failure', async () => {
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'meta', workingDirectory: '/tmp/muse-workdir' }, { spawnMuseProcess });

      child.stderr.emit('data', Buffer.from('x'.repeat(5 * 1024 * 1024)));
      child.emit('exit', 1);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.message.length).toBeLessThanOrEqual(16 * 1024);
    });

    // Finding #5 (FR-4 doctrine): process exit alone is not success — a
    // clean exit with no validated success terminal record fails the probe.
    it('fails a clean exit that produced no terminal record', async () => {
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'meta', workingDirectory: '/tmp/muse-workdir' }, { spawnMuseProcess });

      child.emit('exit', 0);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/terminal/i);
    });

    it('succeeds on a clean exit with a validated completed terminal', async () => {
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({
        kind: 'meta',
        workingDirectory: '/tmp/muse-workdir',
        defaultSonnetModel: 'muse-spark-1.3-contributor',
      }, { spawnMuseProcess });

      child.stdout.emit('data', Buffer.from(`${museProbeCompletedOutput()}\n`));
      child.emit('exit', 0);
      const result = await promise;

      expect(result).toEqual({
        success: true,
        message: 'Connection successful',
        details: { model: 'muse-spark-1.3-contributor' },
      });
    });

    it('ENOENT maps to install-help failure message', async () => {
      const child = createMockGeminiChild();
      const spawnMuseProcess = vi.fn(() => child);

      const promise = testProviderConnection({ kind: 'meta', workingDirectory: '/tmp/muse-workdir' }, { spawnMuseProcess });
      const error = new Error('spawn muse ENOENT');
      error.code = 'ENOENT';
      child.emit('error', error);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.message).toContain('Muse CLI not found');
    });

    // Round-3 finding #10: a timed-out `muse exec` must die as a group —
    // killing only the direct child can strand grandchildren.
    it('kills a timed-out probe as a process group when a pid is available', async () => {
      const child = createMockGeminiChild();
      child.pid = 424242;
      const spawnMuseProcess = vi.fn(() => child);
      const killProcessGroup = vi.fn();

      const result = await testProviderConnection(
        { kind: 'meta', workingDirectory: '/tmp/muse-workdir', apiTimeoutMs: 25 },
        { spawnMuseProcess, killProcessGroup },
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/timed out/);
      expect(killProcessGroup).toHaveBeenCalledWith(-424242, 'SIGTERM');
      expect(child.kill).not.toHaveBeenCalled();
    });

    it('falls back to child.kill when the group kill throws', async () => {
      const child = createMockGeminiChild();
      child.pid = 424243;
      const spawnMuseProcess = vi.fn(() => child);
      const killProcessGroup = vi.fn(() => { throw new Error('ESRCH'); });

      const result = await testProviderConnection(
        { kind: 'meta', workingDirectory: '/tmp/muse-workdir', apiTimeoutMs: 25 },
        { spawnMuseProcess, killProcessGroup },
      );

      expect(result.success).toBe(false);
      expect(killProcessGroup).toHaveBeenCalledWith(-424243, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
