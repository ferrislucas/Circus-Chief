import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  buildMuseSummaryArgs, buildMuseSummaryPrompt, callMuseSummary, MUSE_SUMMARY_TIMEOUT_MS,
  normalizeMuseOutputSchema,
} from './summaryMuseClient.js';
import { SESSION_SUMMARY_SCHEMA } from './summaryClaudeClient.js';

const record = (sequence, payload_type, payload) => JSON.stringify({
  schema_version: 1, record_type: 'event', sequence, payload_type, payload,
});
const accepted = (sequence = 1, command_id = 'cmd-active') => record(sequence, 'runtime.command.accepted', { command_id });
const linked = (sequence = 2, command_id = 'cmd-active', runId = 'run-active') => record(sequence, 'session.run.linked', { command_id, run_stream: { id: runId } });
const terminal = (sequence, outcome, text) => record(sequence, `run.terminal.${outcome}`, {
  command_id: 'cmd-active', run_stream: { id: 'run-active' }, terminal: outcome, text, reason: null,
});
const completedStdout = (text) => `${accepted()}\n${linked()}\n${terminal(3, 'completed', text)}\n`;
const failedTerminal = (sequence, reason) => record(sequence, 'run.terminal.failed', {
  command_id: 'cmd-active', run_stream: { id: 'run-active' }, terminal: 'failed', text: null, reason,
});
const failedStdout = (reason) => `${accepted()}\n${linked()}\n${failedTerminal(3, reason)}\n`;

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
      'exec', '--json', '--workspace', '/tmp/work',
      '--model', 'muse-spark-1.3', '--output-schema', '/tmp/schema', 'text',
    ]);
    // `muse exec` requires session logging for its local messaging transport.
    expect(args).not.toContain('--no-session-log');
  });

  it('normalizes object schemas with additionalProperties false for the Meta API', () => {
    const schema = {
      type: 'object',
      properties: {
        short_summary: { type: 'string' },
        key_actions: { type: 'array', items: { type: 'string' } },
      },
      required: ['short_summary'],
    };
    const normalized = normalizeMuseOutputSchema(schema);
    expect(normalized).toMatchObject({ type: 'object', additionalProperties: false });
    expect(normalized.properties.key_actions).toMatchObject({ type: 'array' });
    // Input is not mutated.
    expect(schema).not.toHaveProperty('additionalProperties');
  });

  it('preserves explicit additionalProperties values', () => {
    expect(normalizeMuseOutputSchema({ type: 'object', additionalProperties: true }))
      .toMatchObject({ additionalProperties: true });
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
      { prompt: 'conversation', systemPrompt: 'system', model: 'muse-spark-1.3', jsonSchema: { type: 'object', properties: {} } },
      { fs, spawn },
    );
    expect(result).toBe('{"short_summary":"ok"}');
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ command: 'muse', cwd: process.cwd() }));
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/muse-isolated/summary-schema.json',
      JSON.stringify({ type: 'object', properties: {}, additionalProperties: false }),
      'utf8',
    );
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

  it('normalizes the session summary schema with a complete required list', () => {
    const normalized = normalizeMuseOutputSchema(SESSION_SUMMARY_SCHEMA);
    expect(normalized.required).toHaveLength(7);
    expect(normalized.required).toEqual(expect.arrayContaining([
      'short_summary', 'full_summary', 'key_actions', 'files_modified',
      'outcome', 'pr_url', 'session_title',
    ]));
    expect(normalized).toMatchObject({ additionalProperties: false });
    // The shared schema itself is untouched by the boundary fix.
    expect(SESSION_SUMMARY_SCHEMA.required).toHaveLength(5);
  });

  it('backfills required recursively in nested object subschemas', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
          required: ['a'],
        },
      },
      required: ['nested'],
    };
    const normalized = normalizeMuseOutputSchema(schema);
    expect(normalized.properties.nested.required).toEqual(['a', 'b']);
    expect(normalized.properties.nested).toMatchObject({ additionalProperties: false });
  });

  it('keeps the terminal failure reason as log-only detail on nonzero exit', async () => {
    const reason = "API error 400: 'required' is required to be supplied and to be an array including every key in properties. Missing 'pr_url'.";
    const fs = testFs();
    const child = childWith({ stdout: failedStdout(reason), exitCode: 1 });
    const failure = await callMuseSummary(
      { prompt: 'x', model: 'muse-spark-1.3', jsonSchema: {} },
      { fs, spawn: vi.fn(() => child) },
    ).catch((error) => error);
    expect(failure).toMatchObject({ code: 'MUSE_SUMMARY_NON_ZERO_EXIT' });
    expect(failure.publicMessage).toBe('Muse could not generate a summary. Please try again.');
    expect(failure.publicMessage).not.toContain('pr_url');
    expect(failure.detail).toContain("Missing 'pr_url'");
  });

  it('omits detail when nonzero-exit stdout is not parseable', async () => {
    const fs = testFs();
    const child = childWith({ stdout: 'not json at all {{{', exitCode: 1 });
    const failure = await callMuseSummary(
      { prompt: 'x', model: 'muse-spark-1.3', jsonSchema: {} },
      { fs, spawn: vi.fn(() => child) },
    ).catch((error) => error);
    expect(failure).toMatchObject({ code: 'MUSE_SUMMARY_NON_ZERO_EXIT' });
    expect(failure).not.toHaveProperty('detail');
  });

  it('preserves an already-complete required list without mutating the input', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['b', 'a'],
    };
    const normalized = normalizeMuseOutputSchema(schema);
    expect(normalized.required).toEqual(['b', 'a']);
    expect(normalized.required).not.toBe(schema.required);
    expect(schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['b', 'a'],
    });
  });
});
