import { describe, it, expect } from 'vitest';
import { toggleTaskLine } from './taskList.js';

describe('toggleTaskLine', () => {
  it('flips an unchecked item to checked and back', () => {
    expect(toggleTaskLine('- [ ] task', 0)).toBe('- [x] task');
    expect(toggleTaskLine('- [x] task', 0)).toBe('- [ ] task');
  });

  it('supports *, +, ordered and paren markers with indentation', () => {
    expect(toggleTaskLine('* [ ] task', 0)).toBe('* [x] task');
    expect(toggleTaskLine('+ [ ] task', 0)).toBe('+ [x] task');
    expect(toggleTaskLine('1. [ ] task', 0)).toBe('1. [x] task');
    expect(toggleTaskLine('2) [ ] task', 0)).toBe('2) [x] task');
    expect(toggleTaskLine('  - [ ] nested', 0)).toBe('  - [x] nested');
  });

  it('unchecks both [x] and [X] to [ ]', () => {
    expect(toggleTaskLine('- [X] task', 0)).toBe('- [ ] task');
  });

  it('writes X when the file predominantly uses X', () => {
    const lines = ['- [X] a', '- [X] b', '- [x] c', '- [ ] target'];
    expect(toggleTaskLine(lines.join('\n'), 3)).toBe(
      '- [X] a\n- [X] b\n- [x] c\n- [X] target',
    );
  });

  it('writes x by default and on ties', () => {
    expect(toggleTaskLine('- [ ] target', 0)).toBe('- [x] target');
    expect(toggleTaskLine('- [X] a\n- [x] b\n- [ ] target', 2)).toBe(
      '- [X] a\n- [x] b\n- [x] target',
    );
  });

  it('leaves fenced code blocks untouched', () => {
    const src = '```\n- [ ] code\n```\n- [ ] real';
    expect(toggleTaskLine(src, 1)).toBe(src);
    expect(toggleTaskLine(src, 3)).toBe('```\n- [ ] code\n```\n- [x] real');
  });

  it('leaves tilde fences untouched', () => {
    const src = '~~~\n- [ ] code\n~~~\n- [ ] real';
    expect(toggleTaskLine(src, 1)).toBe(src);
  });

  it('returns content unchanged for out-of-range, non-task and empty input', () => {
    expect(toggleTaskLine('- [ ] task', 5)).toBe('- [ ] task');
    expect(toggleTaskLine('- [ ] task', -1)).toBe('- [ ] task');
    expect(toggleTaskLine('- plain item', 0)).toBe('- plain item');
    expect(toggleTaskLine('- [] broken', 0)).toBe('- [] broken');
    expect(toggleTaskLine('', 0)).toBe('');
    expect(toggleTaskLine(null, 0)).toBe(null);
  });

  it('changes only the target line in multi-line input', () => {
    const src = '# Plan\n- [ ] one\n- [ ] two\n';
    expect(toggleTaskLine(src, 2)).toBe('# Plan\n- [ ] one\n- [x] two\n');
  });

  it('is idempotent modulo X-case for x-convention files', () => {
    const src = '- [ ] a\n- [x] b';
    expect(toggleTaskLine(toggleTaskLine(src, 0), 0)).toBe(src);
  });

  it('handles a bare "- [ ]" with no trailing text', () => {
    expect(toggleTaskLine('- [ ]', 0)).toBe('- [x]');
  });
});
