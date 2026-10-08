import { describe, expect, it } from 'vitest';
import { createMuseExecProtocol } from './museExecProtocol.js';

const record = (sequence, payload_type, payload, { record_type = 'event', id } = {}) => JSON.stringify({
  schema_version: 1, record_type, sequence, payload_type, payload, ...(id ? { id } : {}),
});
const accepted = (sequence = 1, command_id = 'cmd-active') => record(sequence, 'runtime.command.accepted', { command_id });
const linked = (sequence = 2, command_id = 'cmd-active', runId = 'run-active') => record(sequence, 'session.run.linked', { command_id, run_stream: { id: runId } });
const terminal = (sequence, outcome, { command_id = 'cmd-active', runId = 'run-active', id, ...payload } = {}) => record(
  sequence, `run.terminal.${outcome}`, { command_id, run_stream: { id: runId }, terminal: outcome, ...payload }, { id },
);
const push = (parser, ...lines) => parser.push(`${lines.join('\n')}\n`);

// Scrubbed from `muse exec --json --provider echo` on Muse Code 1.4.2. The
// CLI's full envelopes have more metadata; this preserves the actual fields
// relevant to framing and ownership while omitting prompt/workspace content.
const muse142ConcatenatedCapture = [
  {
    schema_version: 1, id: '018f0000-0000-7000-8000-00000000c350', stream: { kind: 'session', id: 'session-capture' }, sequence: 1,
    recorded_at: 1780531400000000, record_type: 'reconciliation', durability: 'durable', causation_id: 'command-capture', payload_type: 'runtime.command.accepted', payload_schema_version: 1,
    payload: { kind: 'command_accepted', command_id: 'command-capture', client_id: null, command_kind: 'turn.submit' },
  },
  {
    schema_version: 1, id: '018f0000-0000-7000-8000-00000000c351', stream: { kind: 'session', id: 'session-capture' }, sequence: 2,
    recorded_at: 1780531400000001, record_type: 'event', durability: 'durable', causation_id: 'command-capture', payload_type: 'session.run.linked', payload_schema_version: 1,
    payload: { kind: 'session_run_linked', command_id: 'command-capture', run_stream: { kind: 'run', id: 'command-capture' } },
  },
  {
    schema_version: 1, id: '018f0000-0000-7000-8000-00000000c36f', stream: { kind: 'session', id: 'session-capture' }, sequence: 18,
    recorded_at: 1780531400000031, record_type: 'status', durability: 'ephemeral', causation_id: 'command-capture', payload_type: 'run.output.delta', payload_schema_version: 1,
    payload: { kind: 'run_output_delta', command_id: 'command-capture', run_stream: { kind: 'run', id: 'command-capture' }, text: 'echo response' },
  },
  {
    schema_version: 1, id: '018f0000-0000-7000-8000-00000000c383', stream: { kind: 'session', id: 'session-capture' }, sequence: 28,
    recorded_at: 1780531400000051, record_type: 'event', durability: 'durable', causation_id: 'command-capture', payload_type: 'run.terminal.completed', payload_schema_version: 1,
    payload: { kind: 'run_terminal', command_id: 'command-capture', run_stream: { kind: 'run', id: 'command-capture' }, terminal: 'completed', text: 'echo response', reason: null },
  },
].map((envelope) => JSON.stringify(envelope)).join('');

describe('muse exec protocol', () => {
  it('parses a concatenated Muse 1.4.2 stdout capture across arbitrary chunks', () => {
    const parser = createMuseExecProtocol();
    const events = [];
    for (let offset = 0; offset < muse142ConcatenatedCapture.length; offset += 37) {
      events.push(...parser.push(muse142ConcatenatedCapture.slice(offset, offset + 37)));
    }
    expect(events).toContainEqual({ kind: 'text', text: 'echo response' });
    expect(events).toContainEqual({ kind: 'terminal', outcome: 'completed', text: 'echo response', reason: null });
    expect(parser.end()).toEqual([]);
  });

  it('buffers split JSONL records and recognizes a matching completed terminal', () => {
    const parser = createMuseExecProtocol();
    const line = `${accepted()}\n${linked()}\n${terminal(3, 'completed', { text: 'Done' })}\n`;
    expect(parser.push(line.slice(0, 12))).toEqual([]);
    expect(parser.push(line.slice(12))).toContainEqual({ kind: 'terminal', outcome: 'completed', text: 'Done', reason: null });
    expect(parser.end()).toEqual([]);
  });

  it('ignores fully identified terminals from reconciliation or another command run', () => {
    const parser = createMuseExecProtocol();
    expect(push(parser,
      terminal(1, 'completed', { command_id: 'cmd-old', runId: 'run-old', text: 'old' }),
      accepted(2), linked(3),
      terminal(4, 'completed', { command_id: 'cmd-old', runId: 'run-old', text: 'old again' }),
      terminal(5, 'completed', { runId: 'run-other', text: 'other' }),
      terminal(6, 'completed', { text: 'active' }),
    )).toEqual([{ kind: 'accepted', commandId: 'cmd-active' }, { kind: 'unknown', payloadType: 'session.run.linked' }, { kind: 'terminal', outcome: 'completed', text: 'active', reason: null }]);
  });

  it('ignores a follow-up inbox-drain command accepted after the active terminal', () => {
    const parser = createMuseExecProtocol();
    const followupTerminal = (sequence, outcome, extra = {}) => record(
      sequence, `run.terminal.${outcome}`,
      { command_id: 'cmd-followup', run_stream: { id: 'run-followup' }, terminal: outcome, ...extra },
    );
    const followupLinked = record(5, 'session.run.linked', { command_id: 'cmd-followup', run_stream: { id: 'run-followup' } });
    const followupAccepted = record(4, 'runtime.command.accepted', { command_id: 'cmd-followup' });
    expect(push(parser,
      accepted(), linked(), terminal(3, 'completed', { text: 'Done' }),
      followupAccepted, followupLinked, followupTerminal(6, 'cancelled', { reason: 'cancelled' }),
    )).toEqual([
      { kind: 'accepted', commandId: 'cmd-active' },
      { kind: 'unknown', payloadType: 'session.run.linked' },
      { kind: 'terminal', outcome: 'completed', text: 'Done', reason: null },
      { kind: 'accepted', commandId: 'cmd-followup' },
      { kind: 'unknown', payloadType: 'session.run.linked' },
    ]);
    expect(parser.end()).toEqual([]);
  });

  it('accepts an exact active terminal replay once', () => {
    const parser = createMuseExecProtocol();
    expect(push(parser, accepted(), linked(), terminal(3, 'completed', { text: 'Done', id: 'terminal-1' }), terminal(4, 'completed', { text: 'changed replay text', id: 'terminal-1' })))
      .toContainEqual({ kind: 'terminal', outcome: 'completed', text: 'Done', reason: null });
  });

  it('rejects conflicting active terminals with bounded scrubbed diagnostics', () => {
    const seen = [];
    const parser = createMuseExecProtocol({ onDiagnostic: (diagnostics) => seen.push(diagnostics) });
    push(parser, accepted(), linked(), terminal(3, 'completed', { text: 'Done', id: 'terminal-1' }));
    expect(() => push(parser, terminal(4, 'failed', { reason: 'nope', id: 'terminal-2' }))).toThrow(/conflicting terminal/);
    expect(seen[0]).toEqual(expect.arrayContaining([expect.objectContaining({ sequence: 4, payloadType: 'run.terminal.failed', commandId: 'cmd-active', runId: 'run-active', terminal: 'failed' })]));
    expect(seen[0]).toHaveLength(4);
    expect(JSON.stringify(seen[0])).not.toContain('Done');
    expect(JSON.stringify(seen[0])).not.toContain('nope');
  });

  it('keeps only the last twenty safe diagnostic envelopes', () => {
    const seen = [];
    const parser = createMuseExecProtocol({ onDiagnostic: (diagnostics) => seen.push(diagnostics) });
    const noise = Array.from({ length: 20 }, (_, index) => record(index + 2, 'run.output.delta', { text: `sensitive ${index}` }));
    push(parser, accepted(), ...noise, linked(22), terminal(23, 'completed', { text: 'Done' }));
    expect(() => push(parser, terminal(24, 'failed', { reason: 'secret reason' }))).toThrow(/conflicting terminal/);
    expect(seen[0]).toHaveLength(20);
    expect(seen[0][0].sequence).toBe(5);
    expect(JSON.stringify(seen[0])).not.toContain('sensitive');
    expect(JSON.stringify(seen[0])).not.toContain('secret reason');
  });

  it('rejects missing ownership and an active terminal before its run link', () => {
    const missing = createMuseExecProtocol();
    expect(() => push(missing, terminal(1, 'completed', { command_id: null, text: 'bad' }))).toThrow(/ownership identifiers/);
    const early = createMuseExecProtocol();
    push(early, accepted());
    expect(() => push(early, terminal(2, 'completed', { text: 'bad' }))).toThrow(/before linking/);
  });

  it.each(['failed', 'cancelled'])('requires a matching terminal payload for %s', (outcome) => {
    const parser = createMuseExecProtocol();
    push(parser, accepted(), linked());
    expect(() => push(parser, record(3, `run.terminal.${outcome}`, { command_id: 'cmd-active', run_stream: { id: 'run-active' }, terminal: 'completed' }))).toThrow(/unsupported terminal/);
  });

  it('rejects duplicated or out-of-order envelope sequences', () => {
    const parser = createMuseExecProtocol();
    push(parser, accepted(2));
    expect(() => push(parser, linked(1))).toThrow(/out of order/);
  });

  it('enforces the record size limit even without newline framing', () => {
    const parser = createMuseExecProtocol({ maxRecordBytes: 16 });
    expect(() => parser.push('{"schema_version":1')).toThrow(/record exceeded/);
  });

  it('forwards tool results with bounded text for mid-turn work logs', () => {
    const parser = createMuseExecProtocol();
    expect(push(parser,
      accepted(), linked(),
      record(3, 'tool.result', { kind: 'tool_result', call_id: 'call-1', task_id: 'task-8', text: 'wrote 40 bytes' }),
    )).toContainEqual({ kind: 'tool_result', text: 'wrote 40 bytes', taskId: 'task-8' });
  });

  it('bounds oversized tool result text', () => {
    const parser = createMuseExecProtocol();
    const [mapped] = push(parser,
      accepted(), linked(),
      record(3, 'tool.result', { kind: 'tool_result', call_id: 'call-1', text: `x${'y'.repeat(9000)}` }),
    ).filter((item) => item.kind === 'tool_result');
    expect(mapped.taskId).toBeNull();
    expect(mapped.text).toHaveLength(8000 + '… (truncated)'.length);
    expect(mapped.text.endsWith('… (truncated)')).toBe(true);
  });

  it('forwards the CLI-supplied tool identity on tool results (bounded to 240 chars)', () => {
    const parser = createMuseExecProtocol();
    const [mapped] = push(parser,
      accepted(), linked(),
      record(3, 'tool.result', { kind: 'tool_result', call_id: 'call-1', task_id: 'task-8', text: 'wrote 40 bytes', event: { task_id: 'task-8', tool_name: 'Read' } }),
    ).filter((item) => item.kind === 'tool_result');
    expect(mapped.tool_name).toBe('Read');
    const [long] = push(parser,
      record(4, 'tool.result', { kind: 'tool_result', call_id: 'call-2', text: 'more', event: { tool_name: `T${'o'.repeat(300)}` } }),
    ).filter((item) => item.kind === 'tool_result');
    expect(long.tool_name).toHaveLength(240);
    const lone = createMuseExecProtocol();
    const [absent] = push(lone,
      accepted(), linked(),
      record(3, 'tool.result', { kind: 'tool_result', call_id: 'call-1', text: 'wrote 40 bytes' }),
    ).filter((item) => item.kind === 'tool_result');
    expect(absent.tool_name).toBeUndefined();
  });

  it('reads task kind from event.task_kind with fallback to top-level task_kind', () => {
    const parser = createMuseExecProtocol();
    expect(push(parser,
      accepted(), linked(),
      record(3, 'task.lifecycle.started', { kind: 'task_lifecycle', task_kind: null, task_id: 'task-3', event: { kind: 'started', task_kind: 'model.unknown.response', task_id: 'task-3' } }),
      record(4, 'task.lifecycle.started', { kind: 'task_lifecycle', task_kind: 'model.response', task_id: 'task-4', event: { kind: 'started', task_id: 'task-4' } }),
      record(5, 'task.lifecycle.started', { kind: 'task_lifecycle', task_kind: null, event: { kind: 'started' } }),
    )).toEqual([
      { kind: 'accepted', commandId: 'cmd-active' },
      { kind: 'unknown', payloadType: 'session.run.linked' },
      { kind: 'progress', phase: 'started', taskKind: 'model.unknown.response', taskId: 'task-3' },
      { kind: 'progress', phase: 'started', taskKind: 'model.response', taskId: 'task-4' },
      { kind: 'progress', phase: 'started', taskKind: null, taskId: null },
    ]);
  });

  it('forwards task status messages and output chunks for progress notices', () => {
    const parser = createMuseExecProtocol();
    expect(push(parser,
      accepted(), linked(),
      record(3, 'task.lifecycle.status', { kind: 'task_lifecycle', event: { kind: 'status', message: 'opening meta model stream attempt 1/10' } }),
      record(4, 'task.lifecycle.output', { kind: 'task_lifecycle', event: { kind: 'output', chunk: '{"command":"ls"}' } }),
    )).toEqual([
      { kind: 'accepted', commandId: 'cmd-active' },
      { kind: 'unknown', payloadType: 'session.run.linked' },
      { kind: 'progress', phase: 'status', taskKind: null, taskId: null, message: 'opening meta model stream attempt 1/10' },
      { kind: 'progress', phase: 'output', taskKind: null, taskId: null, chunk: '{"command":"ls"}' },
    ]);
  });
});
