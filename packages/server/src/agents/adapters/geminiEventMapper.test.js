import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGeminiEventMapper } from './geminiEventMapper.js';

describe('geminiEventMapper', () => {
  let mapper;

  beforeEach(() => {
    mapper = createGeminiEventMapper({ model: 'gemini-2.5-flash' });
  });

  describe('init event', () => {
    it('maps init to system(init) with session_id and model', () => {
      const result = mapper.map({ type: 'init', session_id: 'abc', model: 'gemini-2.5-flash' });
      expect(result).toEqual([{
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        model: 'gemini-2.5-flash',
      }]);
    });

    it('uses constructor model when init event has no model', () => {
      const m = createGeminiEventMapper({ model: 'gemini-2.5-pro' });
      const result = m.map({ type: 'init', session_id: 'x' });
      expect(result[0].model).toBe('gemini-2.5-pro');
    });
  });

  describe('message events', () => {
    it('maps assistant message with delta:true to text_delta', () => {
      const result = mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'hello' });
      expect(result).toEqual([{
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello' },
        },
      }]);
    });

    it('maps assistant message with delta:false to assistant', () => {
      const result = mapper.map({ type: 'message', role: 'assistant', delta: false, content: 'hello' });
      expect(result).toEqual([{
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }]);
    });

    it('ignores user message events', () => {
      const result = mapper.map({ type: 'message', role: 'user', content: 'hello' });
      expect(result).toEqual([]);
    });

    it('accumulates multiple delta messages into combined text for later flush', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'foo' });
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'bar' });
      // Flush via result
      const result = mapper.map({ type: 'result', status: 'success', stats: { input_tokens: 5, output_tokens: 10 } });
      expect(result[0]).toEqual({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'foobar' }] },
      });
      expect(result[1]).toMatchObject({ type: 'result', subtype: 'success' });
    });

    it('flushes accumulated delta text before tool_use', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'thinking...' });
      const result = mapper.map({ type: 'tool_use', tool_name: 'Bash', tool_id: 't1', parameters: { command: 'ls' } });
      expect(result[0]).toEqual({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'thinking...' }] },
      });
      expect(result[1]).toMatchObject({ type: 'tool_result', tool_name: 'Bash' });
    });

    it('flushes accumulated delta text before tool_result', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'some text' });
      const result = mapper.map({ type: 'tool_result', tool_id: 'x', output: 'output' });
      expect(result[0]).toEqual({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'some text' }] },
      });
      expect(result[1]).toMatchObject({ type: 'tool_result' });
    });

    it('non-delta message after deltas flushes accumulated text first', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'streamed ' });
      const result = mapper.map({ type: 'message', role: 'assistant', delta: false, content: 'full message' });
      // Should flush accumulated + return the non-delta message (avoiding duplicate)
      // The non-delta replaces the accumulated text
      expect(result).toEqual([
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'streamed ' }] },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'full message' }] },
        },
      ]);
    });
  });

  describe('tool events', () => {
    it('maps tool_use event to tool_result with tool name and params', () => {
      const result = mapper.map({
        type: 'tool_use', tool_name: 'Bash', tool_id: 't1', parameters: { command: 'ls' },
      });
      expect(result).toEqual([{
        type: 'tool_result',
        tool_name: 'Bash',
        content: JSON.stringify({ command: 'ls' }),
      }]);
    });

    it('maps tool_result event with matched tool name', () => {
      mapper.map({ type: 'tool_use', tool_name: 'Bash', tool_id: 't1', parameters: {} });
      const result = mapper.map({ type: 'tool_result', tool_id: 't1', output: 'file1\nfile2' });
      expect(result).toEqual([{
        type: 'tool_result',
        tool_name: 'Bash',
        content: 'file1\nfile2',
      }]);
    });

    it('maps tool_result with unknown tool_id to "unknown" tool_name', () => {
      const result = mapper.map({ type: 'tool_result', tool_id: 'unknown-id', output: 'data' });
      expect(result[0].tool_name).toBe('unknown');
    });
  });

  describe('result event', () => {
    it('maps result event to result(success) with token usage', () => {
      const result = mapper.map({
        type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50 },
      });
      expect(result).toEqual([{
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 100, output_tokens: 50 },
      }]);
    });

    it('result sets terminated flag (no duplicate from finalize)', () => {
      mapper.map({ type: 'result', status: 'success', stats: { input_tokens: 10, output_tokens: 5 } });
      const finalized = mapper.finalize();
      expect(finalized).toEqual([]);
    });
  });

  describe('finalize', () => {
    it('emits synthetic result if stream ended without result event', () => {
      const result = mapper.finalize();
      expect(result).toEqual([{
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 0, output_tokens: 0 },
      }]);
    });

    it('flushes accumulated delta text as assistant event before result', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'Hello ' });
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'world' });
      const result = mapper.finalize();
      expect(result).toEqual([
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      ]);
    });
  });

  describe('unknown events', () => {
    it('warns once for unknown event types', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mapper.map({ type: 'unknown_event' });
      mapper.map({ type: 'unknown_event' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('returns [] for null input', () => {
      expect(mapper.map(null)).toEqual([]);
    });

    it('returns [] for non-object input', () => {
      expect(mapper.map('string')).toEqual([]);
    });
  });

  describe('reset', () => {
    it('clears state so finalize emits a new result event', () => {
      mapper.map({ type: 'result', status: 'success', stats: { input_tokens: 10, output_tokens: 5 } });
      mapper.reset();
      const result = mapper.finalize();
      expect(result).toEqual([{
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 0, output_tokens: 0 },
      }]);
    });

    it('clears accumulated delta text on reset', () => {
      mapper.map({ type: 'message', role: 'assistant', delta: true, content: 'accumulated text' });
      mapper.reset();
      // After reset, finalize should NOT include an assistant event
      const result = mapper.finalize();
      expect(result).toEqual([{
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 0, output_tokens: 0 },
      }]);
    });
  });
});
