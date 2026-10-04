/** Maximum persisted progress/unknown notices per turn before suppression. */
export const MAX_MUSE_PROGRESS_NOTICES = 50;

/** Maximum characters kept from a tool output body in one work log. */
export const MAX_MUSE_TOOL_TEXT = 2000;

/**
 * Structural records emitted on every turn with no user-facing value.
 * Suppressed so a turn doesn't open with junk rows like
 * "Muse progress: turn.input.user". Genuinely new payload types still get a
 * one-time notice via the unknown branch below.
 */
const STRUCTURAL_PAYLOAD_TYPES = new Set([
  'session.run.linked',
  'task.stream.linked',
  'turn.input.user',
  'run.model.configured',
]);

/**
 * Mechanical task-lifecycle phases. The CLI emits ~5 of these per task
 * (proposed → accepted → scheduled → side_effect_intent → started) with no
 * human-readable content, so they are dropped. Task boundaries still surface
 * via `started`/`completed`, and real signal comes from `status` messages,
 * tool results, and output summaries below.
 */
const MECHANICAL_PHASES = new Set(['proposed', 'accepted', 'scheduled', 'side_effect_intent', 'rejected']);

export function createMuseExecEventMapper({ model } = {}) {
  const seenUnknown = new Set();
  const state = { lastProgressKey: null };
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
      // Tool results carry the human-readable outcome. Forwarded as
      // tool_output work logs so tool activity is visible mid-turn instead of
      // vanishing into a one-time "Muse progress" notice.
      if (event.kind === 'tool_result' && typeof event.text === 'string' && event.text) {
        return [{ type: 'tool_result', content: formatToolResult(event.text) }];
      }
      if (event.kind === 'progress') {
        const mapped = mapProgressEvent(event, state, notice);
        state.lastProgressKey = mapped.key ?? state.lastProgressKey;
        return mapped.events;
      }
      if (event.kind === 'unknown' && !seenUnknown.has(event.payloadType)) {
        seenUnknown.add(event.payloadType);
        if (STRUCTURAL_PAYLOAD_TYPES.has(event.payloadType)) return [];
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

/**
 * Format a tool result for a persisted work log. Exec-style JSON
 * ({ command, description, exit_code, output }) gets a summary headline plus
 * its output body; other text passes through as-is.
 */
function formatToolResult(text) {
  const parsed = parseExecJson(text);
  if (parsed) {
    const body = typeof parsed.output === 'string' && parsed.output ? `\n${truncate(parsed.output, MAX_MUSE_TOOL_TEXT)}` : '';
    return `${summarizeToolText(text)}${body}`;
  }
  return text;
}

/**
 * Map one task-lifecycle progress event. Returns the mapped events plus the
 * dedup key to store (null when the key is unchanged).
 */
function mapProgressEvent(event, state, notice) {
  // Mechanical phases carry no information — drop them.
  if (MECHANICAL_PHASES.has(event.phase)) return { events: [], key: null };
  // Status records carry the CLI's own progress messages
  // ("opening meta model stream attempt 1/10"). Surface verbatim.
  if (event.phase === 'status') {
    if (!event.message) return { events: [], key: null };
    const key = `status:${event.message}`;
    if (key === state.lastProgressKey) return { events: [], key: null };
    return { events: notice(event.message), key };
  }
  // Output chunks duplicate the tool_result record that arrives with them
  // (same content, same millisecond), so they are dropped — the tool_result
  // branch above persists the full outcome.
  if (event.phase === 'output') return { events: [], key: null };
  const key = `${event.taskKind || 'work'}:${event.phase}`;
  // Consecutive identical progress phases (workflow heartbeats) collapse
  // to one persisted work log instead of one row per record.
  if (key === state.lastProgressKey) return { events: [], key: null };
  return { events: notice(`Muse task ${event.taskKind || 'work'}: ${event.phase}`), key };
}

/**
 * Summarize tool result/output text for a one-line progress notice.
 * Exec-style JSON collapses to its description/command plus exit code;
 * other text is truncated as-is.
 */
function summarizeToolText(text) {
  const parsed = parseExecJson(text);
  if (parsed) {
    const label = parsed.description || parsed.command || 'tool';
    const exit = parsed.exit_code !== undefined ? ` (exit ${parsed.exit_code})` : '';
    return `${label}${exit}`;
  }
  return truncate(text, MAX_MUSE_TOOL_TEXT);
}

function parseExecJson(text) {
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && (parsed.command || parsed.description) ? parsed : null;
  } catch {
    return null;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}
