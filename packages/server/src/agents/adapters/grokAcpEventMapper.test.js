import { describe, expect, it } from 'vitest';
import {
  configOptionIds,
  createGrokAcpEventMapper,
  grokEffortValue,
  modelsFromInitialize,
  normalizeModelIds,
} from './grokAcpEventMapper.js';

describe('grok ACP event mapper', () => {
  it('streams text once and persists a single assistant message', () => {
    const mapper = createGrokAcpEventMapper();
    const first = mapper.mapUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } } });
    const second = mapper.mapUpdate({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } } });
    expect(first[0].event.delta.text).toBe('Hel');
    expect(second[0].event.delta.text).toBe('lo');
    const done = mapper.finish({ stopReason: 'end_turn', _meta: { inputTokens: 3, outputTokens: 2 } });
    expect(done).toEqual([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
      { type: 'result', subtype: 'success', usage: { input_tokens: 3, output_tokens: 2 } },
    ]);
    expect(mapper.finish({ stopReason: 'end_turn' })).toEqual([]);
  });

  it('maps tool calls and ignores unknown updates', () => {
    const mapper = createGrokAcpEventMapper();
    expect(mapper.mapUpdate({ update: { sessionUpdate: 'plan' } })).toEqual([]);
    const started = mapper.mapUpdate({
      update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read', rawInput: { path: 'a' } },
    });
    expect(started[0].message.content[0]).toMatchObject({ type: 'tool_use', id: 't1', name: 'read' });
    const finished = mapper.mapUpdate({
      update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: 'ok' },
    });
    expect(finished[0]).toMatchObject({ type: 'tool_result', tool_name: 'read', content: 'ok' });
  });

  it('reads models and effort from ACP payloads without inventing ids', () => {
    expect(modelsFromInitialize({
      _meta: { modelState: { currentModelId: 'grok-build', availableModels: [{ id: 'grok-build' }, 'nope id', ''] } },
    })).toEqual(['grok-build']);
    expect(normalizeModelIds(['ok', 'has space'])).toEqual(['ok']);
    expect(grokEffortValue('max')).toBe('xhigh');
    expect(grokEffortValue('auto')).toBeNull();
    expect(grokEffortValue('minimal')).toBeNull();
    expect([...configOptionIds({ configOptions: [{ id: 'model' }, { configId: 'reasoning_effort' }] })]).toEqual(['model', 'reasoning_effort']);
  });
});
