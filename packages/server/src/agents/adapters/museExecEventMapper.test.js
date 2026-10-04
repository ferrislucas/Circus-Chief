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
