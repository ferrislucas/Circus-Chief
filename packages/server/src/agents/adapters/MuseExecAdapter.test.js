import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MuseExecAdapter } from './MuseExecAdapter.js';

function fakeSpawn(output, code = 0, onSpawn = () => {}) {
  return (_command, args) => {
    onSpawn(args);
    const child = new EventEmitter();
    child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => {
      const stdout = Array.isArray(output) ? output.join('\n') + (output.length ? '\n' : '') : output;
      child.stdout.end(stdout);
      child.stderr.end();
      child.emit('exit', code);
    });
    return child;
  };
}
const record = (record_type, sequence, payload_type, payload) => JSON.stringify({ schema_version: 1, record_type, sequence, payload_type, payload });
const event = (sequence, payload_type, payload) => record('event', sequence, payload_type, payload);
const currentRun = (text = 'Finished') => [
  event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
  event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
  event(3, 'run.lifecycle.started', {}),
  event(4, 'run.terminal.completed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'completed', text }),
];
async function collect(adapter) {
  const events = [];
  for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) events.push(item);
  return events;
}

describe('MuseExecAdapter', () => {
  it('defaults to a twelve-hour per-turn timeout', () => {
    const adapter = new MuseExecAdapter();
    expect(adapter._timeouts.turnMs).toBe(12 * 60 * 60_000);
  });

  it('accepts Muse reconciliation records before streaming a completed response', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      record('reconciliation', 1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'run.lifecycle.started', {}),
      event(4, 'run.terminal.completed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'completed', text: 'Finished' }),
    ]) }));

    expect(events).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'Finished' }] } });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('requires both a final JSON terminal and a clean process exit', async () => {
    const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      ...currentRun(),
    ]) });
    const events = await collect(adapter);
    expect(events).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'Finished' }] } });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  it('accepts adjacent JSON objects from Muse stdout without newline framing', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn(currentRun().join('')) }));
    expect(events).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'Finished' }] } });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  it('does not silently succeed when the process exits without a terminal event', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([event(1, 'run.lifecycle.started', {})]) }));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error' });
  });
  it('creates and persists a native Muse session id for a first turn', async () => {
    let args;
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      ...currentRun(),
    ], 0, (receivedArgs) => { args = receivedArgs; }) }));
    const init = events.find((item) => item.type === 'system' && item.subtype === 'init');
    expect(init.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(init.session_id);
  });
  it('reuses the stored native Muse session id for a continuation', async () => {
    const resumedId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; let args;
    const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      ...currentRun(),
    ], 0, (receivedArgs) => { args = receivedArgs; }) });
    const events = [];
    for await (const item of adapter.execute({ prompt: 'Continue', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll', resume: resumedId } })) events.push(item);
    expect(events.find((item) => item.type === 'system' && item.subtype === 'init')).toMatchObject({ session_id: resumedId });
    expect(args[args.indexOf('--session-id') + 1]).toBe(resumedId);
  });
  it('advertises native continuation without replaying conversation history', () => {
    const adapter = new MuseExecAdapter();
    expect(adapter.supportsResume()).toBe(true);
    expect(adapter.needsConversationContext()).toBe(false);
  });
  it('maps a validated failed terminal to an error result', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'run.terminal.failed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'failed', reason: 'Muse failed' }),
    ]) }));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error', error: 'Muse failed' });
  });
  it('maps a validated cancelled terminal to a cancelled result', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'run.terminal.cancelled', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'cancelled', reason: 'Stopped' }),
    ]) }));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'cancelled' });
  });
});
