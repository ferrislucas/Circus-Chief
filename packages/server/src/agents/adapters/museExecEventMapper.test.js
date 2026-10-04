import { describe, expect, it } from 'vitest';
import { createMuseExecEventMapper, MAX_MUSE_PROGRESS_NOTICES } from './museExecEventMapper.js';

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
      .toEqual([{ type: 'tool_result', content: 'Muse task work: started' }]);
    expect(mapper.map({ kind: 'progress', phase: 'completed', taskKind: 'work' }))
      .toEqual([{ type: 'tool_result', content: 'Muse task work: completed' }]);
  });

  it('surfaces status messages verbatim and collapses repeats', () => {
    const mapper = createMuseExecEventMapper({});
    const message = 'opening meta model stream attempt 1/10';
    expect(mapper.map({ kind: 'progress', phase: 'status', message }))
      .toEqual([{ type: 'tool_result', content: message }]);
    expect(mapper.map({ kind: 'progress', phase: 'status', message })).toEqual([]);
    expect(mapper.map({ kind: 'progress', phase: 'status', message: null })).toEqual([]);
  });

  it('drops output chunks that duplicate the accompanying tool result', () => {
    const mapper = createMuseExecEventMapper({});
    const chunk = JSON.stringify({ command: 'ls -la /tmp', description: 'List workspace contents', exit_code: 0, output: 'total 0' });
    expect(mapper.map({ kind: 'progress', phase: 'output', chunk })).toEqual([]);
  });

  it('suppresses structural records but still notices genuinely new types', () => {
    const mapper = createMuseExecEventMapper({});
    for (const payloadType of ['session.run.linked', 'task.stream.linked', 'turn.input.user', 'run.model.configured']) {
      expect(mapper.map({ kind: 'unknown', payloadType })).toEqual([]);
    }
    expect(mapper.map({ kind: 'unknown', payloadType: 'some.future.type' }))
      .toEqual([{ type: 'tool_result', content: 'Muse progress: some.future.type' }]);
  });

  it('forwards tool results as tool_output work logs with headline and body', () => {
    const mapper = createMuseExecEventMapper({});
    expect(mapper.map({ kind: 'tool_result', text: 'wrote 40 bytes to /tmp/out.txt' }))
      .toEqual([{ type: 'tool_result', content: 'wrote 40 bytes to /tmp/out.txt' }]);
    const chunk = JSON.stringify({ command: 'ls', description: 'List files', exit_code: 0, output: 'a\nb' });
    expect(mapper.map({ kind: 'tool_result', text: chunk }))
      .toEqual([{ type: 'tool_result', content: 'List files (exit 0)\na\nb' }]);
    expect(mapper.map({ kind: 'tool_result', text: '' })).toEqual([]);
  });
});
