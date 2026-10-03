import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildMuseSummaryArgs, buildMuseSummaryPrompt, callMuseSummary, MUSE_SUMMARY_TIMEOUT_MS,
} from './summaryMuseClient.js';

const record = (sequence, payload_type, payload) => JSON.stringify({
  schema_version: 1, record_type: 'event', sequence, payload_type, payload,
});
const accepted = (sequence = 1, command_id = 'cmd-active') => record(sequence, 'runtime.command.accepted', { command_id });
const linked = (sequence = 2, command_id = 'cmd-active', runId = 'run-active') => record(sequence, 'session.run.linked', { command_id, run_stream: { id: runId } });
const terminal = (sequence, outcome, text) => record(sequence, `run.terminal.${outcome}`, {
  command_id: 'cmd-active', run_stream: { id: 'run-active' }, terminal: outcome, text, reason: null,
});
const completedStdout = (text) => `${accepted()}\n${linked()}\n${terminal(3, 'completed', text)}\n`;

function childWith({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('exit', exitCode);
  });
  return child;
}

function testFs() {
  return {
    mkdtemp: vi.fn().mockResolvedValue('/tmp/muse-isolated'),
    writeFile: vi.fn().mockResolvedValue(),
    rm: vi.fn().mockResolvedValue(),
  };
}

describe('summaryMuseClient', () => {
  it('builds a headless muse exec invocation with schema shaping', () => {
    const args = buildMuseSummaryArgs({ model: 'muse-spark-1.3', schemaPath: '/tmp/schema', cwd: '/tmp/work', prompt: 'text' });
    expect(args).toEqual([
      'exec', '--json', '--no-session-log', '--workspace', '/tmp/work',
      '--model', 'muse-spark-1.3', '--output-schema', '/tmp/schema', 'text',
    ]);
  });

  it('routes large prompts through a prompt file', () => {
    const args = buildMuseSummaryArgs({ model: 'muse-spark-1.3', schemaPath: '/tmp/schema', cwd: '/tmp/work', promptFile: '/tmp/prompt.txt' });
    expect(args).toContain('--prompt-file');
    expect(args).toContain('/tmp/prompt.txt');
  });

  it('composes system and user prompts with a JSON-only instruction', () => {
    expect(buildMuseSummaryPrompt('system', 'conversation')).toContain('Return only the requested JSON summary');
  });

  it('returns the terminal text and cleans its isolated directory', async () => {
    const fs = testFs();
    const spawn = vi.fn(() => childWith({ stdout: completedStdout('{"short_summary":"ok"}') }));
    const result = await callMuseSummary(
      { prompt: 'conversation', systemPrompt: 'system', model: 'muse-spark-1.3', jsonSchema: {} },
      { fs, spawn },
    );
    expect(result).toBe('{"short_summary":"ok"}');
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ command: 'muse' }));
    expect(fs.rm).toHaveBeenCalledWith('/tmp/muse-isolated', { recursive: true, force: true });
  });

  it('rejects unsupported models before spawning', async () => {
    const spawn = vi.fn();
    await expect(callMuseSummary({ prompt: 'x', model: 'not-supported', jsonSchema: {} }, { spawn }))
      .rejects.toMatchObject({ code: 'MUSE_SUMMARY_UNSUPPORTED_MODEL' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('classifies authentication failures without exposing stderr', async () => {
    const fs = testFs();
    const child = childWith({ stdout: '', stderr: 'Muse is not authenticated. Run muse auth first.', exitCode: 1 });
    await expect(callMuseSummary({ prompt: 'x', model: 'muse-spark-1.3', jsonSchema: {} }, { fs, spawn: vi.fn(() => child) }))
      .rejects.toMatchObject({ code: 'MUSE_SUMMARY_AUTHENTICATION' });
  });

  it('maps a missing binary to a user-actionable error', async () => {
    const fs = testFs();
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit('error', Object.assign(new Error('spawn muse ENOENT'), { code: 'ENOENT' })));
    await expect(callMuseSummary({ prompt: 'x', model: 'muse-spark-1.3', jsonSchema: {} }, { fs, spawn: vi.fn(() => child) }))
      .rejects.toMatchObject({ code: 'MUSE_SUMMARY_CLI_NOT_FOUND' });
  });

  it('rejects a clean exit without a terminal result', async () => {
    const fs = testFs();
    const child = childWith({ stdout: `${accepted()}\n${linked()}\n`, exitCode: 0 });
    await expect(callMuseSummary({ prompt: 'x', model: 'muse-spark-1.3', jsonSchema: {} }, { fs, spawn: vi.fn(() => child) }))
      .rejects.toMatchObject({ code: 'MUSE_SUMMARY_MALFORMED_OUTPUT' });
  });

  it('uses the configured summary timeout by default', () => {
    expect(MUSE_SUMMARY_TIMEOUT_MS).toBe(180_000);
  });
});
