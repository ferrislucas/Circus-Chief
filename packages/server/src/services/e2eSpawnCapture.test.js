import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  captureSpawnAttempt,
  createCapturedSpawnProcess,
  isE2ESpawnCaptureEnabled,
} from './e2eSpawnCapture.js';

describe('e2eSpawnCapture', () => {
  const originalCaptureFile = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-spawn-capture-test-'));
    delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
    vi.useRealTimers();
  });

  afterEach(() => {
    if (originalCaptureFile === undefined) {
      delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
    } else {
      process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = originalCaptureFile;
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
      },
    });
    expect(record.args).toContain('--model');
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
        'commit_attribution=Codex <noreply@openai.com>',
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
        config: [
          'commit_attribution=Codex <noreply@openai.com>',
          'model_reasoning_effort=high',
        ],
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
