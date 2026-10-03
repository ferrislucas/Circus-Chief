import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MuseExecAdapter } from './MuseExecAdapter.js';

function fakeSpawn(lines, code = 0, onSpawn = () => {}) {
  return (_command, args) => {
    onSpawn(args);
    const child = new EventEmitter();
    child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end(lines.join('\n') + (lines.length ? '\n' : ''));
      child.stderr.end();
      child.emit('exit', code);
    });
    return child;
  };
}
const event = (sequence, payload_type, payload) => JSON.stringify({ schema_version: 1, record_type: 'event', sequence, payload_type, payload });
async function collect(adapter) {
  const events = [];
  for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) events.push(item);
  return events;
}

describe('MuseExecAdapter', () => {
  it('requires both a final JSON terminal and a clean process exit', async () => {
    const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'run.lifecycle.started', {}),
      event(2, 'run.terminal.completed', { terminal: 'completed', text: 'Finished' }),
    ]) });
    const events = await collect(adapter);
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
      event(1, 'run.lifecycle.started', {}),
      event(2, 'run.terminal.completed', { terminal: 'completed', text: 'Finished' }),
    ], 0, (receivedArgs) => { args = receivedArgs; }) }));
    const init = events.find((item) => item.type === 'system' && item.subtype === 'init');
    expect(init.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(init.session_id);
  });
  it('reuses the stored native Muse session id for a continuation', async () => {
    const resumedId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; let args;
    const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'run.lifecycle.started', {}),
      event(2, 'run.terminal.completed', { terminal: 'completed', text: 'Finished' }),
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
});
