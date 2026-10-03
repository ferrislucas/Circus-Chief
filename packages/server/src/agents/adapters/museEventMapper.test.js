import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMuseEventMapper } from './museEventMapper.js';

describe('createMuseEventMapper', () => {
  let warnSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('mapItem', () => {
    it('returns [] for non-object input', () => {
      const mapper = createMuseEventMapper();
      expect(mapper.mapItem(null)).toEqual([]);
      expect(mapper.mapItem('text')).toEqual([]);
    });

    it('ignores userMessage echoes and retracted items', () => {
      const mapper = createMuseEventMapper();
      expect(mapper.mapItem({ kind: 'userMessage', text: 'hi' })).toEqual([]);
      expect(mapper.mapItem({ kind: 'agentMessage', text: 'hi', retracted: true })).toEqual([]);
    });

    it('maps agentMessage text to text_delta + assistant', () => {
      const mapper = createMuseEventMapper();
      const events = mapper.mapItem({ kind: 'agentMessage', text: 'Hello' });
      expect(events).toEqual([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello' }] },
        },
      ]);
    });

    it('returns [] for empty agentMessage text', () => {
      const mapper = createMuseEventMapper();
      expect(mapper.mapItem({ kind: 'agentMessage', text: '' })).toEqual([]);
      expect(mapper.mapItem({ kind: 'agentMessage' })).toEqual([]);
    });

    it('maps reasoning text to a reasoning tool_result', () => {
      const mapper = createMuseEventMapper();
      expect(mapper.mapItem({ kind: 'reasoning', text: 'because' })).toEqual([
        { type: 'tool_result', tool_name: 'reasoning', content: 'because' },
      ]);
    });

    it('maps toolCall preferring visibleOutput, then result, then args', () => {
      const mapper = createMuseEventMapper();
      expect(
        mapper.mapItem({ kind: 'toolCall', tool: 'bash', visibleOutput: 'out', result: 'res', args: '{}' })
      ).toEqual([{ type: 'tool_result', tool_name: 'bash', content: 'out' }]);
      expect(
        mapper.mapItem({ kind: 'toolCall', tool: 'bash', result: { ok: true }, args: '{}' })
      ).toEqual([{ type: 'tool_result', tool_name: 'bash', content: '{"ok":true}' }]);
      expect(
        mapper.mapItem({ kind: 'toolCall', tool: 'bash', args: '{"cmd":"ls"}' })
      ).toEqual([{ type: 'tool_result', tool_name: 'bash', content: '{"cmd":"ls"}' }]);
    });

    // Finding #12b: an args-only toolCall carrying a structured (object)
    // `args` must render parseable JSON, not the String()-collapsed
    // `[object Object]`.
    it('renders an args-only toolCall object as parseable JSON (finding #12b)', () => {
      const mapper = createMuseEventMapper();
      const [event] = mapper.mapItem({
        kind: 'toolCall', tool: 'bash', args: { command: ['echo', 'hi'], cwd: '/tmp' },
      });
      expect(event.content).not.toContain('[object Object]');
      expect(JSON.parse(event.content)).toEqual({ command: ['echo', 'hi'], cwd: '/tmp' });
    });

    it('passes toolCall output through verbatim: scrubbing is the stream handler\u2019s job (finding #1)', () => {
      // The mapper is pure (no env access) and MUST NOT redact: secret
      // scrubbing happens at the single choke point in streamEventHandler
      // (scrubEventForLogging), which sees the turn's session env.
      const mapper = createMuseEventMapper();
      const [event] = mapper.mapItem({
        kind: 'toolCall', tool: 'bash', visibleOutput: 'token GH_TOKEN_SENTINEL_VALUE echoed back',
      });
      expect(event.content).toBe('token GH_TOKEN_SENTINEL_VALUE echoed back');
    });

    it('appends failure details to toolCall content', () => {
      const mapper = createMuseEventMapper();
      const [event] = mapper.mapItem({
        kind: 'toolCall', tool: 'bash', visibleOutput: 'denied', failureReason: 'policy denied',
      });
      expect(event.content).toBe('denied\nfailure: policy denied');
    });

    it('maps userShell command, exit code, and output', () => {
      const mapper = createMuseEventMapper();
      const [event] = mapper.mapItem({
        kind: 'userShell', commandText: 'ls', exitCode: 1, visibleOutput: 'nope',
      });
      expect(event).toEqual({
        type: 'tool_result',
        tool_name: 'user_shell',
        content: '$ ls\nexit code: 1\nnope',
      });
    });

    it('summarizes subagent/workflow/compaction kinds', () => {
      const mapper = createMuseEventMapper();
      const [subagent] = mapper.mapItem({
        kind: 'subagent', objective: 'explore', childSessionId: 'child-1',
      });
      expect(subagent.tool_name).toBe('subagent');
      expect(subagent.content).toContain('explore');
      expect(subagent.content).toContain('child-1');

      const [compaction] = mapper.mapItem({ kind: 'compaction', fallbackText: 'compacted' });
      expect(compaction).toEqual({
        type: 'tool_result', tool_name: 'compaction', content: 'compacted',
      });
    });

    it('renders unknown kinds generically when fallbackText exists, else a transcript notice (finding #11)', () => {
      const mapper = createMuseEventMapper();
      const [generic] = mapper.mapItem({ kind: 'futureKind', status: 'completed', fallbackText: 'did stuff' });
      expect(generic).toEqual({
        type: 'tool_result', tool_name: 'futureKind', content: 'did stuff',
      });
      // No renderable text: a generic notice lands in the transcript so the
      // dropped item is visible (not console-only).
      const [notice] = mapper.mapItem({ kind: 'futureKind', status: 'completed' });
      expect(notice).toMatchObject({ type: 'tool_result', tool_name: 'futureKind' });
      expect(notice.content).toMatch(/futureKind.*no display text/);
      // Warn-once per kind on the console
      mapper.mapItem({ kind: 'futureKind' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapOutcome', () => {
    it('maps completed turns to success with snake_case usage', () => {
      const mapper = createMuseEventMapper();
      const [result] = mapper.mapOutcome({
        kind: 'completed',
        params: { terminal: 'completed', usage: { inputTokens: 10, outputTokens: 5 } },
      });
      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    it('ignores additive 1.4 cache and cost usage fields', () => {
      const mapper = createMuseEventMapper();
      const [result] = mapper.mapOutcome({
        kind: 'completed',
        params: {
          terminal: 'completed',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 7,
            cacheWriteTokens: 2,
            cost: { usd: 0.0042, partial: false },
          },
        },
      });
      expect(result).toEqual({
        type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    it('maps failed terminals and turn errors to error results', () => {
      const mapper = createMuseEventMapper();
      const [failed] = mapper.mapOutcome({
        kind: 'completed',
        params: { terminal: 'failed', error: { kind: 'modelError', message: 'boom', retryable: false } },
      });
      expect(failed.subtype).toBe('error');
      expect(failed.is_error).toBe(true);
      expect(failed.error).toBe('boom');

      const mapper2 = createMuseEventMapper();
      const [cancelled] = mapper2.mapOutcome({ kind: 'completed', params: { terminal: 'cancelled' } });
      expect(cancelled.subtype).toBe('error');
    });

    it('maps unqueued and terminalUnknown outcomes to error results', () => {
      const mapper = createMuseEventMapper();
      const [unqueued] = mapper.mapOutcome({ kind: 'unqueued', params: {} });
      expect(unqueued.subtype).toBe('error');
      const mapper2 = createMuseEventMapper();
      const [unknown] = mapper2.mapOutcome({ kind: 'terminalUnknown' });
      expect(unknown.subtype).toBe('error');
    });

    it('returns [] for non-object outcomes', () => {
      expect(createMuseEventMapper().mapOutcome(null)).toEqual([]);
    });
  });

  describe('mapCancellation', () => {
    it('emits a cancelled terminal and suppresses a later finalize', () => {
      const mapper = createMuseEventMapper();
      const [cancelled] = mapper.mapCancellation();
      expect(cancelled).toEqual({ type: 'result', subtype: 'cancelled' });
      expect(mapper.finalize()).toEqual([]);
    });
  });

  describe('finalize/reset', () => {
    it('emits a visible error when the execution ends without an outcome', () => {
      const mapper = createMuseEventMapper();
      const [result] = mapper.finalize();
      expect(result).toEqual({
        type: 'result', subtype: 'error', is_error: true,
        error: 'Muse execution ended without a terminal result.',
      });
      expect(mapper.finalize()).toEqual([]);
    });

    it('emits nothing after an outcome was already mapped', () => {
      const mapper = createMuseEventMapper();
      mapper.mapOutcome({ kind: 'completed', params: { terminal: 'completed' } });
      expect(mapper.finalize()).toEqual([]);
    });

    it('reset re-arms finalize', () => {
      const mapper = createMuseEventMapper();
      mapper.mapOutcome({ kind: 'completed', params: { terminal: 'completed' } });
      mapper.reset();
      expect(mapper.finalize()).toHaveLength(1);
    });
  });

  describe('buildSystemInit', () => {
    it('carries the MSP session id and optional model', () => {
      const mapper = createMuseEventMapper({ model: 'muse-spark-1.3' });
      expect(mapper.buildSystemInit('msp-123')).toEqual({
        type: 'system', subtype: 'init', session_id: 'msp-123', model: 'muse-spark-1.3',
      });
      expect(createMuseEventMapper().buildSystemInit('msp-123')).toEqual({
        type: 'system', subtype: 'init', session_id: 'msp-123',
      });
    });
  });
});
