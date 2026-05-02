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
    expect(m.map({ type: 'item.started', item: { id: 'i', type: 'agent_message', text: '' } })).toEqual([]);
  });

  it('item.completed(agent_message) emits stream_event(text_delta) + assistant', () => {
    const m = createCodexEventMapper();
    const out = m.map({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: 'Hello, world' },
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

  it('item.completed with unknown item types returns [] and warns once per type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = createCodexEventMapper();

    const mcp = m.map({
      type: 'item.completed',
      item: { id: 'm1', type: 'mcp_tool_call' },
    });
    expect(mcp).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Second mcp_tool_call does not re-warn
    const mcp2 = m.map({
      type: 'item.completed',
      item: { id: 'm2', type: 'mcp_tool_call' },
    });
    expect(mcp2).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A different unsupported type warns again
    const web = m.map({
      type: 'item.completed',
      item: { id: 'w1', type: 'web_search' },
    });
    expect(web).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('item.completed(command_execution) emits tool_result with command and output', () => {
    const m = createCodexEventMapper({ model: 'o4-mini' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/zsh -lc "sed -n \'1,220p\' file1.txt"',
        aggregated_output: 'hello world\n',
        exit_code: 0,
        status: 'completed',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool_result',
      tool_name: 'command_execution',
    });
    expect(out[0].content).toContain('sed');
    expect(out[0].content).toContain('hello world');
  });

  it('item.completed(file_change) emits tool_result with change list', () => {
    const m = createCodexEventMapper({ model: 'o4-mini' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'item_3',
        type: 'file_change',
        changes: [{ path: '/tmp/codex-test-dir/file1.txt', kind: 'update' }],
        status: 'completed',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool_result',
      tool_name: 'file_change',
    });
    expect(out[0].content).toContain('/tmp/codex-test-dir/file1.txt');
    expect(out[0].content).toContain('update');
  });

  it('item.completed(file_change) with multiple changes lists all files', () => {
    const m = createCodexEventMapper({ model: 'o4-mini' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'item_4',
        type: 'file_change',
        changes: [
          { path: '/tmp/a.js', kind: 'update' },
          { path: '/tmp/b.js', kind: 'add' },
        ],
        status: 'completed',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('/tmp/a.js');
    expect(out[0].content).toContain('/tmp/b.js');
  });

  it('item.completed(reasoning) emits tool_result with thinking text (v0.124.0 shape: plain text field)', () => {
    const m = createCodexEventMapper({ model: 'gpt-5.2' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'item_4',
        type: 'reasoning',
        text: '**Crafting analysis report**\n\nI need to analyze two files and compare their contents.',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool_result',
      tool_name: 'reasoning',
    });
    expect(out[0].content).toContain('Crafting analysis report');
  });

  it('item.completed(reasoning) handles legacy content array shape', () => {
    const m = createCodexEventMapper({ model: 'gpt-5.2' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'r_0',
        type: 'reasoning',
        content: [{ type: 'text', text: 'I should check the file first...' }],
        summary: [],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('I should check the file first');
  });

  it('command_execution with non-zero exit code includes output and exit code', () => {
    const m = createCodexEventMapper({ model: 'o4-mini' });
    const out = m.map({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/zsh -lc "sed -n \'1,120p\' /tmp/nonexistent.txt"',
        aggregated_output: 'sed: /tmp/nonexistent.txt: No such file or directory\n',
        exit_code: 1,
        status: 'failed',
      },
    });
    expect(out[0].content).toContain('No such file or directory');
    expect(out[0].content).toContain('exit code: 1');
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

  it('handles real CLI v0.124.0 wire format (agent_message)', () => {
    const m = createCodexEventMapper({ model: 'gpt-5.2' });
    expect(m.map({ type: 'thread.started', thread_id: 't1' })).toHaveLength(1);
    expect(m.map({ type: 'turn.started' })).toEqual([]);
    const out = m.map({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Hi!' },
    });
    expect(out).toEqual([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi!' } },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi!' }] } },
    ]);
    const fin = m.map({
      type: 'turn.completed',
      usage: { input_tokens: 15105, cached_input_tokens: 13696, output_tokens: 25 },
    });
    expect(fin[0]).toMatchObject({ type: 'result', subtype: 'success', usage: { input_tokens: 15105, output_tokens: 25 } });
  });

  it('ignores non-object inputs gracefully', () => {
    const m = createCodexEventMapper();
    expect(m.map(null)).toEqual([]);
    expect(m.map(undefined)).toEqual([]);
    expect(m.map('string')).toEqual([]);
  });
});
