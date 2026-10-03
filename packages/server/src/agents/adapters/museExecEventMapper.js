export function createMuseExecEventMapper({ model } = {}) {
  const seenUnknown = new Set();
  return {
    init: (sessionId) => ({ type: 'system', subtype: 'init', ...(sessionId ? { session_id: sessionId } : {}), ...(model ? { model } : {}) }),
    map(event) {
      if (event.kind === 'text' && event.text) return [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: event.text } } }];
      if (event.kind === 'progress') return [{ type: 'tool_result', content: `Muse task ${event.taskKind || 'work'}: ${event.phase}` }];
      if (event.kind === 'unknown' && !seenUnknown.has(event.payloadType)) { seenUnknown.add(event.payloadType); return [{ type: 'tool_result', content: `Muse progress: ${event.payloadType}` }]; }
      return [];
    },
    final(terminal) {
      if (terminal?.outcome === 'cancelled') return [{ type: 'result', subtype: 'cancelled' }];
      if (terminal?.outcome !== 'completed') return [{ type: 'result', subtype: 'error', is_error: true, error: terminal?.reason || 'Muse execution failed.' }];
      if (!terminal.text) return [{ type: 'result', subtype: 'error', is_error: true, error: 'Muse completed without a final response.' }];
      return [
        { type: 'assistant', message: { content: [{ type: 'text', text: terminal.text }] } },
        { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 } },
      ];
    },
  };
}
