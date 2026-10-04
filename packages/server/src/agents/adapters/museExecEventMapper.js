/** Maximum persisted progress/unknown notices per turn before suppression. */
export const MAX_MUSE_PROGRESS_NOTICES = 50;

export function createMuseExecEventMapper({ model } = {}) {
  const seenUnknown = new Set();
  let lastProgressKey = null;
  let progressNotices = 0;
  const notice = (content) => {
    if (progressNotices >= MAX_MUSE_PROGRESS_NOTICES) return [];
    progressNotices += 1;
    const suffix = progressNotices === MAX_MUSE_PROGRESS_NOTICES ? ' (further Muse progress suppressed for this turn)' : '';
    return [{ type: 'tool_result', content: `${content}${suffix}` }];
  };
  return {
    init: (sessionId) => ({ type: 'system', subtype: 'init', ...(sessionId ? { session_id: sessionId } : {}), ...(model ? { model } : {}) }),
    map(event) {
      if (event.kind === 'text' && event.text) return [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: event.text } } }];
      // Consecutive identical progress phases (workflow heartbeats) collapse
      // to one persisted work log instead of one row per record.
      if (event.kind === 'progress') {
        const key = `${event.taskKind || 'work'}:${event.phase}`;
        if (key === lastProgressKey) return [];
        lastProgressKey = key;
        return notice(`Muse task ${event.taskKind || 'work'}: ${event.phase}`);
      }
      if (event.kind === 'unknown' && !seenUnknown.has(event.payloadType)) {
        seenUnknown.add(event.payloadType);
        return notice(`Muse progress: ${event.payloadType}`);
      }
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
