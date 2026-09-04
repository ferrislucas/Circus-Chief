import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  captureSpawnAttempt,
  createCapturedSpawnProcess,
  consumeScriptedOutcome,
  isE2ESpawnCaptureEnabled,
  resetE2ESpawnCaptureSequence,
} from './e2eSpawnCapture.js';

describe('e2eSpawnCapture', () => {
  const originalCaptureFile = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  const originalScriptFile = process.env.E2E_AGENT_SPAWN_SCRIPT_FILE;
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-spawn-capture-test-'));
    delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
    delete process.env.E2E_AGENT_SPAWN_SCRIPT_FILE;
    resetE2ESpawnCaptureSequence();
    vi.useRealTimers();
  });

  afterEach(() => {
    if (originalCaptureFile === undefined) {
      delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
    } else {
      process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = originalCaptureFile;
    }
    if (originalScriptFile === undefined) {
      delete process.env.E2E_AGENT_SPAWN_SCRIPT_FILE;
    } else {
      process.env.E2E_AGENT_SPAWN_SCRIPT_FILE = originalScriptFile;
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('reports whether spawn capture is enabled', () => {
    expect(isE2ESpawnCaptureEnabled()).toBe(false);

    process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = join(tempDir, 'capture.jsonl');

    expect(isE2ESpawnCaptureEnabled()).toBe(true);
  });

  it('captures Claude spawn attempts with summarized options', () => {
    const captureFile = join(tempDir, 'capture.jsonl');
    process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = captureFile;

    captureSpawnAttempt('claude-code', {
      command: 'claude',
      args: [
        '--model',
        'claude-sonnet-4-20250514',
        '--settings',
        '{"attribution":{"commit":"Claude"}}',
        '--permission-mode',
        'acceptEdits',
        '--setting-sources',
        'user,project,local',
        '--mcp-config',
        JSON.stringify({
          mcpServers: {
            safeName: { command: 'node', args: ['secret.js'], env: { TOKEN: 'secret' } },
            remoteName: { type: 'http', url: 'https://secret.example.test/mcp', headers: { Authorization: 'Bearer secret' } },
          },
        }),
      ],
      cwd: tempDir,
    });

    const record = JSON.parse(readFileSync(captureFile, 'utf8').trim());
    expect(record).toMatchObject({
      agentType: 'claude-code',
      command: 'claude',
      cwd: tempDir,
      options: {
        model: 'claude-sonnet-4-20250514',
        settings: '{"attribution":{"commit":"Claude"}}',
        permissionMode: 'acceptEdits',
        settingSources: 'user,project,local',
        mcpServers: [
          { name: 'safeName', transport: 'stdio' },
          { name: 'remoteName', transport: 'http' },
        ],
      },
    });
    expect(record.args).toContain('--model');
    expect(record.args).toContain('[redacted]');
    expect(JSON.stringify(record)).not.toContain('secret.js');
    expect(JSON.stringify(record)).not.toContain('Bearer secret');
    expect(record.capturedAt).toEqual(expect.any(String));
  });

  it('captures Codex spawn attempts with summarized options', () => {
    const captureFile = join(tempDir, 'capture.jsonl');
    process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = captureFile;

    captureSpawnAttempt('codex', {
      command: 'codex',
      args: [
        'exec',
        '-m',
        'gpt-5.5',
        '--sandbox',
        'workspace-write',
        '-c',
        'model_reasoning_effort=high',
      ],
      cwd: tempDir,
    });

    const record = JSON.parse(readFileSync(captureFile, 'utf8').trim());
    expect(record).toMatchObject({
      agentType: 'codex',
      command: 'codex',
      cwd: tempDir,
      options: {
        model: 'gpt-5.5',
        sandbox: 'workspace-write',
        config: ['model_reasoning_effort=high'],
      },
    });
  });

  it('captures Gemini spawn attempts with summarized options', () => {
    const captureFile = join(tempDir, 'capture.jsonl');
    process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = captureFile;

    captureSpawnAttempt('gemini', {
      command: 'gemini',
      args: [
        '-p',
        'Hi',
        '--output-format',
        'stream-json',
        '--skip-trust',
        '--approval-mode=auto_edit',
        '-m',
        'gemini-2.5-flash',
      ],
      cwd: tempDir,
      env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    });

    const record = JSON.parse(readFileSync(captureFile, 'utf8').trim());
    expect(record).toMatchObject({
      agentType: 'gemini',
      command: 'gemini',
      cwd: tempDir,
      env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      options: {
        model: 'gemini-2.5-flash',
        outputFormat: 'stream-json',
        approvalMode: 'auto_edit',
        prompt: 'Hi',
      },
    });
  });

  it('returns a process-like stub that can be killed', async () => {
    const processStub = createCapturedSpawnProcess('codex');
    const events = collectProcessEvents(processStub);

    expect(processStub.stdin).toBeDefined();
    expect(processStub.stdout).toBeDefined();
    expect(processStub.stderr).toBeDefined();
    expect(processStub.killed).toBe(false);

    expect(processStub.kill('SIGINT')).toBe(true);

    const result = await events;
    expect(processStub.killed).toBe(true);
    expect(processStub.exitCode).toBeNull();
    expect(result).toEqual({
      exit: [null, 'SIGINT'],
      close: [null, 'SIGINT'],
    });
  });

  it('emits Claude JSONL events on completion', async () => {
    const processStub = createCapturedSpawnProcess('claude-code');
    const output = collectStreamLines(processStub.stdout);
    const events = collectProcessEvents(processStub);

    const [lines, result] = await Promise.all([output, events]);

    expect(result).toEqual({ exit: [0, null], close: [0, null] });
    expect(lines.map((line) => line.type)).toEqual(['system', 'assistant', 'result']);
    expect(lines[0]).toMatchObject({ subtype: 'init' });
    expect(lines[1].message.content[0].text).toBe('E2E spawn capture response.');
    expect(lines[2]).toMatchObject({ subtype: 'success' });
  });

  it('emits Codex JSONL events after stdin finishes', async () => {
    const processStub = createCapturedSpawnProcess('codex');
    const output = collectStreamLines(processStub.stdout);
    const events = collectProcessEvents(processStub);

    processStub.stdin.end('prompt');
    const [lines, result] = await Promise.all([output, events]);

    expect(result).toEqual({ exit: [0, null], close: [0, null] });
    expect(lines.map((line) => line.type)).toEqual([
      'thread.started',
      'turn.started',
      'item.completed',
      'turn.completed',
    ]);
    expect(lines[2].item).toMatchObject({
      type: 'agent_message',
      text: 'E2E spawn capture response.',
    });
  });

  it('records the resolved providerId/modelId/sessionId and a monotonic sequence', () => {
    const captureFile = join(tempDir, 'capture.jsonl');
    process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = captureFile;

    captureSpawnAttempt('codex', {
      command: 'codex',
      args: ['exec', '-m', 'gpt-5.5'],
      cwd: tempDir,
      env: {
        CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a',
        CIRCUSCHIEF_E2E_SESSION_ID: 'session-a',
      },
    });
    captureSpawnAttempt('codex', {
      command: 'codex',
      args: ['exec', '-m', 'gpt-5.6'],
      cwd: tempDir,
      env: {
        CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-b',
        CIRCUSCHIEF_E2E_SESSION_ID: 'session-a',
      },
    });

    const records = readFileSync(captureFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      sequence: 1,
      providerId: 'provider-a',
      modelId: 'gpt-5.5',
      sessionId: 'session-a',
    });
    expect(records[1]).toMatchObject({
      sequence: 2,
      providerId: 'provider-b',
      modelId: 'gpt-5.6',
      sessionId: 'session-a',
    });
  });

  describe('consumeScriptedOutcome', () => {
    it('returns a plain success when no script file is configured', () => {
      expect(consumeScriptedOutcome('provider-a', 'model-a')).toEqual({ type: 'success' });
    });

    it('consumes queued outcomes FIFO per (providerId, modelId) and persists the remainder', () => {
      const scriptFile = join(tempDir, 'script.json');
      writeFileSync(scriptFile, JSON.stringify({
        queues: { 'provider-a::model-a': ['quota_error', 'success'] },
      }));
      process.env.E2E_AGENT_SPAWN_SCRIPT_FILE = scriptFile;

      expect(consumeScriptedOutcome('provider-a', 'model-a')).toEqual({ type: 'quota_error' });
      expect(consumeScriptedOutcome('provider-a', 'model-a')).toEqual({ type: 'success' });

      // Queue exhausted — falls back to the script default (absent here → plain success).
      expect(consumeScriptedOutcome('provider-a', 'model-a')).toEqual({ type: 'success' });
    });

    it('falls back to the script default for an unscripted (providerId, modelId) pair', () => {
      const scriptFile = join(tempDir, 'script.json');
      writeFileSync(scriptFile, JSON.stringify({
        queues: { 'provider-a::model-a': ['quota_error'] },
        default: 'success',
      }));
      process.env.E2E_AGENT_SPAWN_SCRIPT_FILE = scriptFile;

      expect(consumeScriptedOutcome('provider-b', 'model-b')).toEqual({ type: 'success' });
    });

    it('supports object-shaped outcomes with a custom message', () => {
      const scriptFile = join(tempDir, 'script.json');
      writeFileSync(scriptFile, JSON.stringify({
        queues: { 'provider-a::model-a': [{ type: 'overloaded', message: 'custom 529 text', delayMs: 5 }] },
      }));
      process.env.E2E_AGENT_SPAWN_SCRIPT_FILE = scriptFile;

      expect(consumeScriptedOutcome('provider-a', 'model-a')).toEqual({
        type: 'overloaded',
        message: 'custom 529 text',
        delayMs: 5,
      });
    });
  });

  describe('scripted outcomes via createCapturedSpawnProcess', () => {
    function writeScript(scriptFile, script) {
      writeFileSync(scriptFile, JSON.stringify(script));
      process.env.E2E_AGENT_SPAWN_SCRIPT_FILE = scriptFile;
    }

    it('emits an eligible-for-failover error (quota) for the scripted (provider, model) pair — Codex', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, { queues: { 'provider-a::gpt-5.5': ['quota_error'] } });

      const processStub = createCapturedSpawnProcess('codex', {
        args: ['exec', '-m', 'gpt-5.5'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a' },
      });
      const events = collectFailureEvents(processStub);

      const result = await events;
      expect(result.error.message.toLowerCase()).toContain('quota');
      expect(result.exit).toEqual([null, null]);
    });

    it('emits a non-eligible auth error unmodified — Gemini', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, { queues: { 'provider-g::gemini-2.5-flash': ['auth_error'] } });

      const processStub = createCapturedSpawnProcess('gemini', {
        args: ['-m', 'gemini-2.5-flash'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-g' },
      });
      const events = collectFailureEvents(processStub);

      const result = await events;
      expect(result.error.message).toContain('401');
      expect(result.error.message.toLowerCase()).not.toMatch(/quota|rate limit|503|529|unavailable|overloaded/);
    });

    it('honors a custom scripted message and delay', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, {
        queues: { 'provider-a::model-a': [{ type: 'service_unavailable', message: 'boom: 503 custom', delayMs: 5 }] },
      });

      const processStub = createCapturedSpawnProcess('codex', {
        args: ['exec', '-m', 'model-a'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a' },
      });
      const events = collectFailureEvents(processStub);

      const result = await events;
      expect(result.error.message).toBe('boom: 503 custom');
    });

    it('writes partial assistant output before failing for output_then_error', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, {
        queues: { 'provider-a::model-a': [{ type: 'output_then_error', delayMs: 5, failDelayMs: 5 }] },
      });

      const processStub = createCapturedSpawnProcess('codex', {
        args: ['exec', '-m', 'model-a'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a' },
      });
      const output = collectStreamLines(processStub.stdout);
      const events = collectFailureEvents(processStub);
      processStub.stdin.end('prompt');

      const [lines, result] = await Promise.all([output, events]);
      expect(lines.map((line) => line.type)).toEqual(['thread.started', 'turn.started', 'item.completed']);
      expect(lines.some((line) => line.type === 'turn.completed')).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it('never auto-completes a cancelled outcome until explicitly killed', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, { queues: { 'provider-a::model-a': ['cancelled'] } });

      const processStub = createCapturedSpawnProcess('codex', {
        args: ['exec', '-m', 'model-a'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a' },
      });

      // Give it a chance to (incorrectly) auto-complete.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(processStub.exitCode).toBeNull();
      expect(processStub.killed).toBe(false);

      const events = collectProcessEvents(processStub);
      expect(processStub.kill('SIGTERM')).toBe(true);
      const result = await events;
      expect(result).toEqual({ exit: [null, 'SIGTERM'], close: [null, 'SIGTERM'] });
    });

    it('delays the success events for delayed_success', async () => {
      const scriptFile = join(tempDir, 'script.json');
      writeScript(scriptFile, { queues: { 'provider-a::model-a': [{ type: 'delayed_success', delayMs: 40 }] } });

      const processStub = createCapturedSpawnProcess('codex', {
        args: ['exec', '-m', 'model-a'],
        env: { CIRCUSCHIEF_E2E_PROVIDER_ID: 'provider-a' },
      });
      const output = collectStreamLines(processStub.stdout);
      const events = collectProcessEvents(processStub);
      const startedAt = Date.now();
      processStub.stdin.end('prompt');

      const [lines, result] = await Promise.all([output, events]);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
      expect(result).toEqual({ exit: [0, null], close: [0, null] });
      expect(lines.map((line) => line.type)).toEqual([
        'thread.started',
        'turn.started',
        'item.completed',
        'turn.completed',
      ]);
    });
  });
});

function collectProcessEvents(processStub) {
  return new Promise((resolve) => {
    const result = {};
    processStub.once('exit', (code, signal) => {
      result.exit = [code, signal];
    });
    processStub.once('close', (code, signal) => {
      result.close = [code, signal];
      resolve(result);
    });
  });
}

/**
 * Like {@link collectProcessEvents}, but also captures the scripted-failure
 * `error` event (production listeners always attach one; here we attach our
 * own so Node's "unhandled 'error' event" special case doesn't crash the test).
 */
function collectFailureEvents(processStub) {
  return new Promise((resolve) => {
    const result = {};
    processStub.once('error', (error) => {
      result.error = error;
    });
    processStub.once('exit', (code, signal) => {
      result.exit = [code, signal];
    });
    processStub.once('close', (code, signal) => {
      result.close = [code, signal];
      resolve(result);
    });
  });
}

function collectStreamLines(stream) {
  return new Promise((resolve) => {
    let output = '';
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    stream.on('end', () => {
      resolve(output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    });
  });
}
