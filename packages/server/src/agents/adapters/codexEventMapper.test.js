import { describe, it, expect, vi } from 'vitest';
import { createCodexEventMapper } from './codexEventMapper.js';

describe('codexEventMapper', () => {
  it('maps thread.started → system(init) with thread_id as session_id', () => {
    const m = createCodexEventMapper();
    const out = m.map({ type: 'thread.started', thread_id: 'codex-xyz' });
    expect(out).toEqual([
      { type: 'system', subtype: 'init', session_id: 'codex-xyz' },
    ]);
  });

  it('thread.started surfaces model from constructor options', () => {
    const m = createCodexEventMapper({ model: 'gpt-4o' });
    const out = m.map({ type: 'thread.started', thread_id: 'codex-xyz' });
    expect(out).toEqual([
      { type: 'system', subtype: 'init', session_id: 'codex-xyz', model: 'gpt-4o' },
    ]);
  });

  it('turn.started and item.started are no-ops', () => {
    const m = createCodexEventMapper();
    expect(m.map({ type: 'turn.started' })).toEqual([]);
    expect(m.map({ type: 'item.started', item: { id: 'i', type: 'agentMessage', text: '' } })).toEqual([]);
  });

  it('item.completed(agentMessage) emits stream_event(text_delta) + assistant', () => {
    const m = createCodexEventMapper();
    const out = m.map({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agentMessage', text: 'Hello, world' },
    });
    expect(out).toEqual([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello, world' } },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello, world' }] },
      },
    ]);
  });

  it('item.completed with non-agentMessage types returns [] and warns once per type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = createCodexEventMapper();

    const reasoning = m.map({
      type: 'item.completed',
      item: { id: 'r1', type: 'reasoning', content: [{ type: 'text', text: 'think' }], summary: [] },
    });
    expect(reasoning).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Second reasoning event does not re-warn
    const reasoning2 = m.map({
      type: 'item.completed',
      item: { id: 'r2', type: 'reasoning', content: [], summary: [] },
    });
    expect(reasoning2).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A different unsupported type warns again
    const cmd = m.map({
      type: 'item.completed',
      item: { id: 'c1', type: 'commandExecution' },
    });
    expect(cmd).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('turn.completed with usage → result(success) with mapped usage', () => {
    const m = createCodexEventMapper();
    const out = m.map({
      type: 'turn.completed',
      usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 4 },
    });
    expect(out).toEqual([{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 12, output_tokens: 4 },
    }]);
  });

  it('turn.completed with no usage → result(success) with zeros', () => {
    const m = createCodexEventMapper();
    const out = m.map({ type: 'turn.completed' });
    expect(out).toEqual([{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 0, output_tokens: 0 },
    }]);
  });

  it('turn.failed → throws with error.message', () => {
    const m = createCodexEventMapper();
    expect(() => m.map({ type: 'turn.failed', error: { message: 'quota exceeded' } })).toThrow('quota exceeded');
  });

  it('turn.failed without message still throws a default', () => {
    const m = createCodexEventMapper();
    expect(() => m.map({ type: 'turn.failed' })).toThrow('Codex turn failed');
  });

  it('error → throws an Error whose message includes the codex message', () => {
    const m = createCodexEventMapper();
    expect(() => m.map({ type: 'error', message: 'rate limit exceeded' })).toThrow('rate limit exceeded');
  });

  it('unknown top-level type → returns [] and logs a warning (does not throw)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = createCodexEventMapper();
    const out = m.map({ type: 'some.brand.new.event' });
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reset() clears usage', () => {
    const m = createCodexEventMapper();
    m.map({ type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 3 } });
    m.reset();
    // After reset, finalize() should emit zero usage (and emit at all, since terminated was cleared)
    const out = m.finalize();
    expect(out).toEqual([{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 0, output_tokens: 0 },
    }]);
  });

  it('finalize() emits a terminal result when no turn.completed seen', () => {
    const m = createCodexEventMapper();
    m.map({ type: 'thread.started', thread_id: 'codex-1' });
    const out = m.finalize();
    expect(out).toEqual([{
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 0, output_tokens: 0 },
    }]);
  });

  it('finalize() returns [] if turn.completed already emitted', () => {
    const m = createCodexEventMapper();
    m.map({ type: 'turn.completed' });
    expect(m.finalize()).toEqual([]);
  });

  it('ignores non-object inputs gracefully', () => {
    const m = createCodexEventMapper();
    expect(m.map(null)).toEqual([]);
    expect(m.map(undefined)).toEqual([]);
    expect(m.map('string')).toEqual([]);
  });
});
