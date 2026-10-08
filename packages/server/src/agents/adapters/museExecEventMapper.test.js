import { describe, expect, it } from 'vitest';
import { createMuseExecEventMapper, normalizeStatusKey, MAX_MUSE_PROGRESS_NOTICES } from './museExecEventMapper.js';

describe('museExecEventMapper progress bounds', () => {
  it('collapses consecutive identical progress phases to one notice', () => {
    const mapper = createMuseExecEventMapper({});
    const first = mapper.map({ kind: 'progress', phase: 'running', taskKind: 'build' });
    const repeat = mapper.map({ kind: 'progress', phase: 'running', taskKind: 'build' });
    const changed = mapper.map({ kind: 'progress', phase: 'completed', taskKind: 'build' });
    expect(first).toHaveLength(1);
    expect(repeat).toEqual([]);
    expect(changed).toHaveLength(1);
  });

  it('caps persisted progress notices per turn', () => {
    const mapper = createMuseExecEventMapper({});
    let emitted = 0;
    for (let i = 0; i < MAX_MUSE_PROGRESS_NOTICES + 10; i += 1) {
      emitted += mapper.map({ kind: 'progress', phase: `phase-${i}`, taskKind: 'work' }).length;
    }
    expect(emitted).toBe(MAX_MUSE_PROGRESS_NOTICES);
  });

  it('still maps text deltas and the terminal result after capping progress', () => {
    const mapper = createMuseExecEventMapper({ model: 'muse-spark-1.3' });
    for (let i = 0; i < MAX_MUSE_PROGRESS_NOTICES + 5; i += 1) {
      mapper.map({ kind: 'progress', phase: `phase-${i}`, taskKind: 'work' });
    }
    expect(mapper.map({ kind: 'text', text: 'hello' })).toHaveLength(1);
    expect(mapper.final({ outcome: 'completed', text: 'done' })).toHaveLength(2);
  });
});

describe('museExecEventMapper mid-turn signal', () => {
  it('drops mechanical lifecycle phases without notices', () => {
    const mapper = createMuseExecEventMapper({});
    for (const phase of ['proposed', 'accepted', 'scheduled', 'side_effect_intent', 'rejected']) {
      expect(mapper.map({ kind: 'progress', phase, taskKind: 'work' })).toEqual([]);
    }
  });

  it('keeps task boundary phases as notices', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'started', taskKind: 'work' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse task work: started' }]);
    expect(mapper.map({ kind: 'progress', phase: 'completed', taskKind: 'work' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse task work: completed' }]);
  });

  it('emits the first status message immediately and coalesces same-group retries', () => {
    const mapper = createMuseExecEventMapper({});
    const first = 'opening meta model stream attempt 1/10';
    const latest = 'opening meta model stream attempt 2/10';
    // (a) first signal for a new group emits immediately — a long retry
    // storm shows progress mid-turn instead of withholding until final().
    expect(mapper.map({ kind: 'progress', phase: 'status', message: first }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: first }]);
    // (b) same-group follow-up only refreshes the pending text.
    expect(mapper.map({ kind: 'progress', phase: 'status', message: latest })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'status', message: null })).toEqual([]);
    // (d) final() with a pending multi-message group emits the latest text.
    const done = mapper.final({ outcome: 'completed', text: 'done' });
    expect(done.filter((event) => event.content?.includes('attempt')))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: latest }]);
  });

  it('normalizes attempt counters out of the status dedupe key', () => {
    expect(normalizeStatusKey('opening meta model stream attempt 1/10'))
      .toBe(normalizeStatusKey('opening meta model stream attempt 2/10'));
    expect(normalizeStatusKey('opening meta model stream attempt 1/10')).toBe('opening meta model stream attempt');
    expect(normalizeStatusKey('retry attempt 3')).toBe('retry attempt');
    expect(normalizeStatusKey('loading session context')).toBe('loading session context');
  });

  it('resolves boundary-phase kinds through the per-turn task registry', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'proposed', taskKind: 'model.unknown.response', taskId: 'task-3' })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-3' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse task model.unknown.response: started' }]);
    expect(mapper.map({ kind: 'progress', phase: 'completed', taskKind: null, taskId: 'task-3' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse task model.unknown.response: completed' }]);
  });

  it('suppresses boundary phases whose kind was never proposed', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-9' })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'completed', taskKind: null, taskId: 'task-9' })).toEqual([]);
  });

  it('suppresses reminder housekeeping tasks in every phase', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'proposed', taskKind: 'reminder.agent.skill-reminder', taskId: 'task-1' })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-1' })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'completed', taskKind: null, taskId: 'task-1' })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'failed', taskKind: 'reminder.agent.verify-reminder', taskId: 'task-2' })).toEqual([]);
  });

  it('keeps the first proposed kind when a later record carries a stray kind (first-write-wins)', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'proposed', taskKind: 'kind-a', taskId: 'task-5' })).toEqual([]);
    // A stray kind on a later status/output record must not overwrite kind-a.
    expect(mapper.map({ kind: 'progress', phase: 'status', taskKind: 'kind-b', taskId: 'task-5', message: 'working' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'working' }]);
    expect(mapper.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-5' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse task kind-a: started' }]);
  });

  it('keeps the task registry per mapper instance with no cross-turn leakage', () => {
    const first = createMuseExecEventMapper({});
    expect(first.map({ kind: 'progress', phase: 'proposed', taskKind: 'model.response', taskId: 'task-4' })).toEqual([]);
    expect(first.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-4' })).toHaveLength(1);
    const second = createMuseExecEventMapper({});
    expect(second.map({ kind: 'progress', phase: 'started', taskKind: null, taskId: 'task-4' })).toEqual([]);
  });

  it('emits first + latest per retry group (at most two rows, liveness over purity)', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'opening meta model stream attempt 1/10' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'opening meta model stream attempt 1/10' }]);
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'opening meta model stream attempt 2/10' })).toEqual([]);
    const done = mapper.final({ outcome: 'completed', text: 'done' });
    expect(done.filter((event) => event.content?.includes('attempt')))
      .toEqual([
        { type: 'tool_result', tool_name: 'Muse', content: 'opening meta model stream attempt 2/10' },
      ]);
  });

  it('emits the collapsed latest-text row for the closed group when a different group arrives', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'opening meta model stream attempt 1/10' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'opening meta model stream attempt 1/10' }]);
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'opening meta model stream attempt 2/10' })).toEqual([]);
    // Closing the attempt group emits its collapsed latest text (it differs
    // from the already-emitted first row) plus the new group's first signal.
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'loading session context' }))
      .toEqual([
        { type: 'tool_result', tool_name: 'Muse', content: 'opening meta model stream attempt 2/10' },
        { type: 'tool_result', tool_name: 'Muse', content: 'loading session context' },
      ]);
  });

  it('emits nothing for the closed group when it never changed past its first row', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'opening meta model stream attempt 1/10' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'opening meta model stream attempt 1/10' }]);
    // Identical re-flush: pending equals the already-emitted first row, so
    // only the new group's first signal emits.
    expect(mapper.map({ kind: 'progress', phase: 'status', message: 'loading session context' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'loading session context' }]);
    const done = mapper.final({ outcome: 'completed', text: 'done' });
    expect(done.filter((event) => event.type === 'tool_result')).toEqual([]);
  });

  it('drops output chunks that duplicate the accompanying tool result', () => {
    const mapper = createMuseExecEventMapper({});
    const chunk = JSON.stringify({ command: 'ls -la /tmp', description: 'List workspace contents', exit_code: 0, output: 'total 0' });
    expect(mapper.map({ kind: 'progress', phase: 'output', chunk })).toEqual([]);
  });

  it('flushes orphaned output chunks with no tool_result at turn end', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'output', taskId: 'task-7', chunk: 'partial tool output' })).toEqual([]);
    expect(mapper.flush()).toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'partial tool output' }]);
    expect(mapper.flush()).toEqual([]);
  });

  it('drops buffered output once its tool_result arrives', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'progress', phase: 'output', taskId: 'task-8', chunk: 'partial output' })).toEqual([]);
    expect(mapper.map({ kind: 'tool_result', text: 'full result', taskId: 'task-8' })).toHaveLength(1);
    expect(mapper.flush()).toEqual([]);
  });

  it('suppresses the workspace-branch structural record', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'unknown', payloadType: 'session.workspace_branch.observed' })).toEqual([]);
  });

  it('suppresses structural records but still notices genuinely new types', () => {
    const mapper = createMuseExecEventMapper({});
    for (const payloadType of ['session.run.linked', 'task.stream.linked', 'turn.input.user', 'run.model.configured']) {
      expect(mapper.map({ kind: 'unknown', payloadType })).toEqual([]);
    }
    expect(mapper.map({ kind: 'unknown', payloadType: 'some.future.type' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse progress: some future type' }]);
  });

  it('suppresses any content-free session.* type (FR-4)', () => {
    const mapper = createMuseExecEventMapper({});
    // The unknown branch only sees the type string, which carries no human
    // content for session.* records — suppress instead of humanizing noise.
    expect(mapper.map({ kind: 'unknown', payloadType: 'session.foo_bar.observed' })).toEqual([]);
    expect(mapper.map({ kind: 'unknown', payloadType: 'session.anything.new' })).toEqual([]);
    // Non-session.* unknowns still get the humanized one-time notice.
    expect(mapper.map({ kind: 'unknown', payloadType: 'some.future.type' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'Muse progress: some future type' }]);
  });

  it('forwards journal usage attached to the terminal into the result event', () => {
    const mapper = createMuseExecEventMapper({});
    const modelUsage = { 'muse-spark': { inputTokens: 100, outputTokens: 20 } };
    const events = mapper.final({
      outcome: 'completed',
      text: 'done',
      usage: { input_tokens: 100, output_tokens: 20 },
      modelUsage,
    });
    expect(events.at(-1)).toEqual({ type: 'result', subtype: 'success', usage: { input_tokens: 100, output_tokens: 20 }, modelUsage });
  });

  it('falls back to zero usage when the terminal carries none', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.final({ outcome: 'completed', text: 'done' }).at(-1))
      .toEqual({ type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 } });
  });

  it('preserves a CLI-supplied tool identity and badges anonymous results Muse', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'tool_result', text: 'file text', tool_name: 'Read' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Read', content: 'file text' }]);
    expect(mapper.map({ kind: 'tool_result', text: 'file text' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'file text' }]);
  });

  it('forwards tool results as tool_output work logs with headline and body', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'tool_result', text: 'wrote 40 bytes to /tmp/out.txt' }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'wrote 40 bytes to /tmp/out.txt' }]);
    const chunk = JSON.stringify({ command: 'ls', description: 'List files', exit_code: 0, output: 'a\nb' });
    expect(mapper.map({ kind: 'tool_result', text: chunk }))
      .toEqual([{ type: 'tool_result', tool_name: 'Muse', content: 'List files (exit 0)\na\nb' }]);
    expect(mapper.map({ kind: 'tool_result', text: '' })).toEqual([]);
  });
});
