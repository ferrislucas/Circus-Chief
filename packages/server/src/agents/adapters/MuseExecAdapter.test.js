import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { MuseExecAdapter, MAX_MUSE_TURN_EVENTS } from './MuseExecAdapter.js';
import { composeCliPrompt } from './cliUtils.js';

function fakeSpawn(output, code = 0, onSpawn = () => {}) {
  return (_command, args) => {
    onSpawn(args);
    const child = new EventEmitter();
    child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    // Production ordering: 'spawn' confirms start before any stream/exit
    // activity. The exit is deferred past the spawn microtask so the
    // adapter's post-start listeners are attached before it can fire.
    queueMicrotask(() => child.emit('spawn'));
    setImmediate(() => {
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

  // Finding #2: there is no startup/idle enforcement — only the total-turn
  // timeout and the shutdown grace period. No other timeout key may linger
  // in the defaults to mislead readers.
  it('exposes exactly the enforced timeouts (no dead startupMs)', () => {
    const adapter = new MuseExecAdapter();
    expect(Object.keys(adapter._timeouts).sort()).toEqual(['shutdownGraceMs', 'turnMs']);
    expect(adapter._timeouts).not.toHaveProperty('startupMs');
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
  it('attaches journal usage flushed during the turn to the terminal result', async () => {
    const viewsDir = await mkdtemp(join(tmpdir(), 'muse-views-'));
    const catalogDir = await mkdtemp(join(tmpdir(), 'muse-catalog-'));
    const resumeId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    await mkdir(join(viewsDir, resumeId), { recursive: true });
    vi.stubEnv('MUSE_SESSION_VIEWS_DIR', viewsDir);
    vi.stubEnv('MUSE_MODEL_CATALOG_DIR', catalogDir);
    try {
      // The CLI flushes its journal while the turn runs (after the adapter's
      // turn-start snapshot), so the entry counts as fresh usage.
      const flushJournal = () => writeFile(join(viewsDir, resumeId, 'journal-00000000.bin'), JSON.stringify({
        method: 'session/tokenUsage',
        params: { usage: { inputTokens: 100, outputTokens: 20 }, modelId: 'muse-spark', turnId: 'turn-1' },
      }));
      const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([...currentRun()], 0, flushJournal) });
      const events = [];
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll', resume: resumeId } })) events.push(item);
      expect(events.at(-1)).toMatchObject({
        type: 'result', subtype: 'success', usage: { input_tokens: 100, output_tokens: 20 },
      });
      expect(events.at(-1).modelUsage['muse-spark']).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  // Finding #4: a journal entry that predates the turn is stale and must not
  // be attached — the terminal falls back to no usage fields.
  it('ignores a pre-turn journal entry instead of misattributing it', async () => {
    const viewsDir = await mkdtemp(join(tmpdir(), 'muse-views-'));
    const catalogDir = await mkdtemp(join(tmpdir(), 'muse-catalog-'));
    const resumeId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    await mkdir(join(viewsDir, resumeId), { recursive: true });
    await writeFile(join(viewsDir, resumeId, 'journal-00000000.bin'), JSON.stringify({
      method: 'session/tokenUsage',
      params: { usage: { inputTokens: 100, outputTokens: 20 }, modelId: 'muse-spark', turnId: 'turn-1' },
    }));
    vi.stubEnv('MUSE_SESSION_VIEWS_DIR', viewsDir);
    vi.stubEnv('MUSE_MODEL_CATALOG_DIR', catalogDir);
    try {
      const adapter = new MuseExecAdapter({ spawnMuseExec: fakeSpawn([...currentRun()]) });
      const events = [];
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll', resume: resumeId } })) events.push(item);
      expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
      // The stale pre-turn reading (100/20) is ignored; the mapper falls
      // back to zeros with no modelUsage.
      expect(events.at(-1)).toMatchObject({ usage: { input_tokens: 0, output_tokens: 0 } });
      expect(events.at(-1)).not.toHaveProperty('modelUsage');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('advertises native continuation without replaying conversation history', () => {
    const adapter = new MuseExecAdapter();
    expect(adapter.supportsResume()).toBe(true);
    expect(adapter.needsConversationContext()).toBe(false);
  });
  it('bounds buffered events on a chatty turn without losing the terminal result', async () => {
    const deltas = Array.from({ length: MAX_MUSE_TURN_EVENTS + 100 }, (_, i) => event(i + 3, 'run.output.delta', { text: `t${i}` }));
    const records = [
      event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      ...deltas,
      event(MAX_MUSE_TURN_EVENTS + 103, 'run.terminal.completed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'completed', text: 'Finished' }),
    ];
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn(records) }));
    // The `session.run.linked` record occupies one notice slot, so the
    // bounded buffer holds it plus exactly MAX-1 deltas — never more.
    const mapped = events.filter((item) => item.type === 'stream_event' || item.type === 'tool_result');
    expect(mapped).toHaveLength(MAX_MUSE_TURN_EVENTS);
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  it('maps a validated failed terminal to an error result', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'run.terminal.failed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'failed', reason: 'Muse failed' }),
    ]) }));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error', error: 'Muse failed' });
  });
  it('yields mapped events before the process exits', async () => {
    let child;
    const adapter = new MuseExecAdapter({
      spawnMuseExec: () => {
        child = new EventEmitter();
        child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        return child;
      },
    });
    const seen = [];
    const pump = (async () => {
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) seen.push(item);
    })();
    await vi.waitFor(() => expect(child).toBeTruthy());
    child.emit('spawn');
    const head = [
      record('reconciliation', 1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'task.lifecycle.status', { event: { kind: 'status', message: 'opening meta model stream attempt 1/10' } }),
    ].join('\n');
    child.stdout.write(`${head}\n`);
    // The status notice must surface while the CLI process is still running —
    // no terminal has arrived and the process has not exited.
    await vi.waitFor(() => {
      expect(seen.find((item) => item.type === 'tool_result' && /opening meta model stream/.test(item.content))).toBeTruthy();
    });
    expect(seen.some((item) => item.type === 'result')).toBe(false);
    child.stdout.end(`${event(4, 'run.terminal.completed', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'completed', text: 'Finished' })}\n`);
    child.stderr.end();
    child.emit('exit', 0);
    await pump;
    expect(seen).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'Finished' }] } });
    expect(seen.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  it('completes when stderr-close and exit arrive after stdout-close', { timeout: 10000 }, async () => {
    let child;
    const adapter = new MuseExecAdapter({
      spawnMuseExec: () => {
        child = new EventEmitter();
        // Raw emitters (no PassThrough timing) expose the real-CLI ordering:
        // stdout can close while stderr and exit are still pending.
        child.pid = 4242; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true;
        return child;
      },
    });
    const seen = [];
    const pump = (async () => {
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) seen.push(item);
    })();
    await vi.waitFor(() => expect(child).toBeTruthy());
    child.emit('spawn');
    // Let the adapter attach its post-start stream listeners before driving
    // the raw-emitter close ordering below.
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.emit('data', `${currentRun().join('\n')}\n`);
    child.stdout.emit('close');
    // Let the drain loop consume everything and park with the turn incomplete.
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen.some((item) => item.type === 'result')).toBe(false);
    // The final settlement arrives with no wake-up in flight — the consumer
    // must still observe it instead of hanging.
    child.stderr.emit('close');
    child.emit('exit', 0);
    await pump;
    expect(seen.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  // Finding #11: the argv path (composeCliPrompt in museExecArgs) and the
  // prompt-file path (adapter's large-prompt composition) must carry
  // byte-identical text for a system-prompt-bearing turn.
  it('writes byte-identical prompt text to the prompt file', async () => {
    const systemPrompt = 'Be helpful.';
    const prompt = `large-${'x'.repeat(25 * 1024)}`;
    let promptFileContent = null;
    const events = [];
    const adapter = new MuseExecAdapter({
      spawnMuseExec: fakeSpawn([...currentRun()], 0, (args) => {
        promptFileContent = readFileSync(args[args.indexOf('--prompt-file') + 1], 'utf8');
      }),
    });
    for await (const item of adapter.execute({ prompt, options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll', systemPrompt } })) events.push(item);
    expect(promptFileContent).toBe(composeCliPrompt(systemPrompt, prompt));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
  it('maps a validated cancelled terminal to a cancelled result', async () => {
    const events = await collect(new MuseExecAdapter({ spawnMuseExec: fakeSpawn([
      event(1, 'runtime.command.accepted', { command_id: 'cmd-123' }),
      event(2, 'session.run.linked', { command_id: 'cmd-123', run_stream: { id: 'run-123' } }),
      event(3, 'run.terminal.cancelled', { command_id: 'cmd-123', run_stream: { id: 'run-123' }, terminal: 'cancelled', reason: 'Stopped' }),
    ]) }));
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'cancelled' });
  });
  // Finding #3: a turn that is already aborted must not spawn a billed
  // `muse exec` child — it resolves to a single cancelled result.
  it('does not spawn a billed child when the turn is already aborted', async () => {
    const spawnMuseExec = vi.fn(fakeSpawn([...currentRun()]));
    const controller = new AbortController();
    controller.abort();
    const adapter = new MuseExecAdapter({ spawnMuseExec });
    const events = [];
    for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll', abortController: controller } })) events.push(item);
    expect(spawnMuseExec).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'result', subtype: 'cancelled' }]);
  });
  // Finding #1: the total-turn timeout must escalate like the abort path —
  // a CLI that ignores SIGTERM is reaped with SIGKILL after the grace
  // period instead of being orphaned.
  it('escalates a hung child to SIGKILL after the total-turn timeout', { timeout: 10000 }, async () => {
    const kills = [];
    let child;
    const adapter = new MuseExecAdapter({
      timeouts: { turnMs: 30, shutdownGraceMs: 20 },
      spawnMuseExec: () => {
        child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        // Ignores SIGTERM like a hung workflow child: records the signal
        // but never exits.
        child.kill = (signal) => { kills.push(signal); return true; };
        return child;
      },
    });
    const events = [];
    try {
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) events.push(item);
    } finally {
      child.stdout.destroy();
      child.stderr.destroy();
    }
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error' });
    expect(kills).toContain('SIGTERM');
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(kills).toContain('SIGKILL');
  });
  // Issue #2: every non-natural terminal path must escalate like the abort
  // path — a CLI that ignores SIGTERM is reaped with SIGKILL after the
  // grace period instead of being orphaned.
  function hungChildSpawn(kills, onChild) {
    return () => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      // Ignores SIGTERM like a hung workflow child: records the signal but
      // never exits.
      child.kill = (signal) => { kills.push(signal); return true; };
      onChild?.(child);
      return child;
    };
  }
  it('escalates to SIGKILL when stdout parsing fails on a hung child', { timeout: 10000 }, async () => {
    const kills = [];
    let child;
    const adapter = new MuseExecAdapter({
      timeouts: { turnMs: 60_000, shutdownGraceMs: 20 },
      spawnMuseExec: hungChildSpawn(kills, (spawned) => { child = spawned; }),
    });
    const events = [];
    const pump = (async () => {
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) events.push(item);
    })();
    await vi.waitFor(() => expect(child).toBeTruthy());
    child.emit('spawn');
    child.stdout.write('not-json\n');
    await pump;
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error' });
    expect(kills).toContain('SIGTERM');
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(kills).toContain('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
  });
  it('escalates to SIGKILL when the child errors on a hung process', { timeout: 10000 }, async () => {
    const kills = [];
    let child;
    const adapter = new MuseExecAdapter({
      timeouts: { turnMs: 60_000, shutdownGraceMs: 20 },
      spawnMuseExec: hungChildSpawn(kills, (spawned) => { child = spawned; }),
    });
    const events = [];
    const pump = (async () => {
      for await (const item of adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } })) events.push(item);
    })();
    await vi.waitFor(() => expect(child).toBeTruthy());
    child.emit('spawn');
    // The error must arrive after the post-start handlers are attached so
    // it travels the post-spawn stream-failure path.
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('error', new Error('spawn boom'));
    await pump;
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error' });
    expect(kills).toContain('SIGTERM');
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(kills).toContain('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
  });
  it('escalates to SIGKILL when the consumer breaks early on a hung child', { timeout: 10000 }, async () => {
    const kills = [];
    let child;
    const adapter = new MuseExecAdapter({
      timeouts: { turnMs: 60_000, shutdownGraceMs: 20 },
      spawnMuseExec: hungChildSpawn(kills, (spawned) => { child = spawned; }),
    });
    const gen = adapter.execute({ prompt: 'Hi', options: { cwd: '/tmp', env: {}, approvalMode: 'allowAll' } });
    await gen.next();
    const second = gen.next();
    await vi.waitFor(() => expect(child).toBeTruthy());
    // Let the turn stream one live event, then break while the child is
    // still alive with no terminal and no exit.
    child.emit('spawn');
    child.stdout.write(`${event(1, 'run.output.delta', { text: 'partial' })}\n`);
    await second;
    await gen.return();
    expect(kills).toContain('SIGTERM');
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(kills).toContain('SIGKILL');
    child.stdout.destroy();
    child.stderr.destroy();
  });
  describe('subprocess start confirmation', () => {
    function cliOptions(overrides = {}) {
      return { cwd: '/tmp', env: {}, approvalMode: 'allowAll', ...overrides };
    }

    it('async pre-spawn error without spawn never signals acceptance and rejects definitively', async () => {
      const adapter = new MuseExecAdapter({
        spawnMuseExec: () => {
          const child = new EventEmitter();
          child.pid = 4242;
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          // Node reports a missing executable asynchronously as 'error'
          // with no 'spawn' — a synchronous throw alone does not model it.
          queueMicrotask(() => {
            const err = new Error('spawn muse ENOENT');
            err.code = 'ENOENT';
            child.emit('error', err);
          });
          return child;
        },
      });
      const onAccepted = vi.fn();
      let caught = null;
      try {
        for await (const _item of adapter.execute(
          { prompt: 'Hi', options: cliOptions() },
          { sessionId: 's1', onProviderAccepted: onAccepted },
        )) { /* drain */ }
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect(caught.code).toBe('MUSE_CLI_NOT_FOUND');
      expect(onAccepted).not.toHaveBeenCalled();
    });

    it('acceptance fires only after confirmed spawn, exactly once', async () => {
      let child;
      const adapter = new MuseExecAdapter({
        spawnMuseExec: () => {
          child = new EventEmitter();
          child.pid = 4242;
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          return child;
        },
      });
      const onAccepted = vi.fn();
      const seen = [];
      const pump = (async () => {
        for await (const item of adapter.execute(
          { prompt: 'Hi', options: cliOptions() },
          { sessionId: 's1', onProviderAccepted: onAccepted },
        )) seen.push(item);
      })();
      await vi.waitFor(() => expect(child).toBeTruthy());
      // The spawner returned but the process has not confirmed start yet.
      expect(onAccepted).not.toHaveBeenCalled();
      child.emit('spawn');
      child.emit('spawn');
      // The stream/exit activity must arrive after the post-start listeners
      // are attached, matching production ordering.
      await new Promise((resolve) => setImmediate(resolve));
      child.stdout.end(`${currentRun().join('\n')}\n`);
      child.stderr.end();
      child.emit('exit', 0);
      await pump;
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted.mock.calls[0][0]).toMatchObject({ adapterType: 'muse', boundary: 'subprocess_start', pid: 4242 });
      expect(seen.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
    });

    it('late spawn after a pre-spawn error never signals acceptance', async () => {
      const adapter = new MuseExecAdapter({
        spawnMuseExec: () => {
          const child = new EventEmitter();
          child.pid = 4242;
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          queueMicrotask(() => {
            const err = new Error('spawn muse ENOENT');
            err.code = 'ENOENT';
            child.emit('error', err);
            child.emit('spawn');
          });
          return child;
        },
      });
      const onAccepted = vi.fn();
      let caught = null;
      try {
        for await (const _item of adapter.execute(
          { prompt: 'Hi', options: cliOptions() },
          { sessionId: 's1', onProviderAccepted: onAccepted },
        )) { /* drain */ }
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect(caught.code).toBe('MUSE_CLI_NOT_FOUND');
      expect(onAccepted).not.toHaveBeenCalled();
    });
  });
});
