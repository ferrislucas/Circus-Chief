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
  'session.workspace_branch.observed',
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
  // Per-turn task_id → kind registry, populated from proposed events (and
  // any phase carrying a kind). Lives on the mapper so consecutive turns
  // never leak kinds into each other.
  const state = { lastProgressKey: null };
  let progressNotices = 0;
  const notice = (content) => {
    if (progressNotices >= MAX_MUSE_PROGRESS_NOTICES) return [];
    progressNotices += 1;
    const suffix = progressNotices === MAX_MUSE_PROGRESS_NOTICES ? ' (further Muse progress suppressed for this turn)' : '';
    // Badge every mapper-emitted row as Muse so the UI never falls back
    // to the `unknown` tool badge (FR-6).
    return [{ type: 'tool_result', tool_name: 'Muse', content: `${content}${suffix}` }];
  };
  // Per-turn trackers below own their mutable scope; the factory only
  // threads them through, so no helper ever assigns to a parameter.
  const kinds = createTaskKindRegistry();
  const statuses = createStatusGroup(notice);
  const outputs = createTaskOutputBuffer(notice);
  // Map one task-lifecycle progress event. Returns the mapped events plus
  // the dedup key to store (null when the key is unchanged).
  const mapProgressEvent = (event) => {
    kinds.record(event);
    // Mechanical phases carry no information — drop them.
    if (MECHANICAL_PHASES.has(event.phase)) return { events: [], key: null };
    if (event.phase === 'status') return statuses.buffer(event);
    if (event.phase === 'output') {
      outputs.buffer(event);
      return { events: [], key: null };
    }
    // Boundary phases resolve their kind through the registry; a kind that
    // is still unresolved (out-of-order records) or housekeeping
    // (reminder.*) is suppressed rather than printed unlabeled.
    const taskKind = kinds.resolve(event);
    if (!taskKind || taskKind.startsWith('reminder.')) return { events: [], key: null };
    const key = `${taskKind}:${event.phase}`;
    // Consecutive identical progress phases (workflow heartbeats) collapse
    // to one persisted work log instead of one row per record.
    if (key === state.lastProgressKey) return { events: [], key: null };
    return { events: notice(`Muse task ${taskKind}: ${event.phase}`), key };
  };
  return {
    init: (sessionId) => ({ type: 'system', subtype: 'init', ...(sessionId ? { session_id: sessionId } : {}), ...(model ? { model } : {}) }),
    map(event) {
      if (event.kind === 'text' && event.text) return [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: event.text } } }];
      // Tool results carry the human-readable outcome. Forwarded as
      // tool_output work logs so tool activity is visible mid-turn instead of
      // vanishing into a one-time "Muse progress" notice.
      if (event.kind === 'tool_result' && typeof event.text === 'string' && event.text) {
        return mapToolResultEvent(event, outputs);
      }
      if (event.kind === 'progress') {
        const mapped = mapProgressEvent(event);
        state.lastProgressKey = mapped.key ?? state.lastProgressKey;
        return mapped.events;
      }
      if (event.kind === 'unknown' && !seenUnknown.has(event.payloadType)) {
        return mapUnknownEvent(event, seenUnknown, notice);
      }
      return [];
    },
    // Surface output chunks orphaned by a missing tool_result (FR-8).
    // The adapter calls this after the terminal arrives and before
    // final(); cleared on flush so a row can never emit twice.
    flush() {
      return outputs.flush();
    },
    final(terminal) {
      const flushed = statuses.flush();
      state.lastProgressKey = flushed.key ?? state.lastProgressKey;
      return [...flushed.events, ...buildTerminalEvents(terminal)];
    },
  };
}

/**
 * Per-turn task_id → kind registry (FR-2). Populated from proposed events
 * (and any phase carrying a kind); one instance per turn, so turns never
 * leak kinds into each other.
 */
function createTaskKindRegistry() {
  const kindsById = new Map();
  return {
    // First-write-wins: the `proposed` kind owns the task_id, so a stray
    // kind on a later status/output record cannot silently overwrite it.
    // Out-of-order stays safe: a kind-less `started` arriving before any
    // `proposed` records nothing and still suppresses.
    record(event) {
      if (event.taskId && event.taskKind && !kindsById.has(event.taskId)) kindsById.set(event.taskId, event.taskKind);
    },
    resolve(event) {
      return event.taskKind || (event.taskId ? kindsById.get(event.taskId) : undefined);
    },
  };
}

/**
 * Emit-first-then-coalesce retry groups for status messages (FR-5). The
 * first message of a group emits immediately so a long retry storm shows
 * live progress mid-turn; same-group retries only refresh the pending
 * text, and the collapsed latest text emits when a different group
 * arrives or at final() — iff it differs from the already-emitted first
 * row. With append-only work-log rows that costs at most two rows per
 * group (first + latest-if-different); single-row purity is surrendered
 * for liveness. A pending group survives task-lifecycle chatter so
 * interleaved retries still collapse. `buffer`/`flush` return the mapped
 * events plus the dedup key to store (null when unchanged).
 */
function createStatusGroup(notice) {
  let pending = null;
  let pendingKey = null;
  let emittedForGroup = null;
  const emit = (message) => {
    const events = notice(message);
    return { events, key: events.length ? `status:${message}` : null };
  };
  const flush = () => {
    if (!pending || pending === emittedForGroup) {
      pending = null;
      pendingKey = null;
      emittedForGroup = null;
      return { events: [], key: null };
    }
    const message = pending;
    pending = null;
    pendingKey = null;
    emittedForGroup = null;
    return emit(message);
  };
  const buffer = (event) => {
    if (!event.message) return { events: [], key: null };
    const key = `status:${normalizeStatusKey(event.message)}`;
    if (pendingKey === key) {
      pending = event.message;
      return { events: [], key: null };
    }
    // A different group closes the previous one: emit its collapsed
    // latest text first (only when it moved past the already-emitted
    // first row), then the new group's first signal immediately.
    const closed = pending && pending !== emittedForGroup ? emit(pending) : { events: [], key: null };
    const first = emit(event.message);
    pending = event.message;
    pendingKey = key;
    emittedForGroup = event.message;
    const events = [...closed.events, ...first.events];
    return { events, key: events.length ? first.key ?? closed.key : null };
  };
  return { buffer, flush };
}

/**
 * Latest-output-chunk buffer per task (FR-8). Chunk text arrives
 * protocol-bounded; one entry per task, cleared on flush. A task whose
 * tool_result arrives is dropped so flush() cannot resurrect duplicates.
 */
function createTaskOutputBuffer(notice) {
  const pendingOutput = new Map();
  const finishedTaskIds = new Set();
  return {
    buffer(event) {
      if (event.taskId && typeof event.chunk === 'string' && event.chunk && !finishedTaskIds.has(event.taskId)) {
        pendingOutput.set(event.taskId, event.chunk);
      }
    },
    trackResult(event) {
      if (!event.taskId) return;
      finishedTaskIds.add(event.taskId);
      pendingOutput.delete(event.taskId);
    },
    flush() {
      const events = [];
      for (const [taskId, chunk] of pendingOutput) {
        if (finishedTaskIds.has(taskId)) continue;
        events.push(...notice(chunk));
      }
      pendingOutput.clear();
      return events;
    },
  };
}

/**
 * Map one unknown wire payload type. Structural records and content-free
 * `session.*` types (FR-4: the branch only sees the type string, which
 * carries no human content for session.* records) are suppressed; genuinely
 * new types get a one-time humanized notice.
 */
function mapUnknownEvent(event, seenUnknown, notice) {
  seenUnknown.add(event.payloadType);
  if (STRUCTURAL_PAYLOAD_TYPES.has(event.payloadType)) return [];
  if (typeof event.payloadType === 'string' && event.payloadType.startsWith('session.')) return [];
  return notice(`Muse progress: ${humanizePayloadType(event.payloadType)}`);
}

/**
 * Map one tool result to its persisted work log, retiring the task's
 * buffered output chunk (superseded, see FR-8).
 */
function mapToolResultEvent(event, outputs) {
  outputs.trackResult(event);
  return [{ type: 'tool_result', tool_name: event.tool_name || 'Muse', content: formatToolResult(event.text) }];
}

/** Build the terminal assistant/result rows for a turn-ending outcome. */
function buildTerminalEvents(terminal) {
  if (terminal?.outcome === 'cancelled') return [{ type: 'result', subtype: 'cancelled' }];
  if (terminal?.outcome !== 'completed') return [{ type: 'result', subtype: 'error', is_error: true, error: terminal?.reason || 'Muse execution failed.' }];
  if (!terminal.text) return [{ type: 'result', subtype: 'error', is_error: true, error: 'Muse completed without a final response.' }];
  // The CLI stdout stream carries no token counts, so usage defaults to
  // zeros unless the adapter attached journal usage to the terminal.
  const usage = terminal.usage?.input_tokens || terminal.usage?.output_tokens
    ? { input_tokens: terminal.usage.input_tokens || 0, output_tokens: terminal.usage.output_tokens || 0 }
    : { input_tokens: 0, output_tokens: 0 };
  return [
    { type: 'assistant', message: { content: [{ type: 'text', text: terminal.text }] } },
    { type: 'result', subtype: 'success', usage, ...(terminal.modelUsage ? { modelUsage: terminal.modelUsage } : {}) },
  ];
}

/**
 * Normalize a status message for retry-group dedupe: attempt counters
 * (`1/10`) and bare trailing attempt numbers collapse so consecutive
 * transport retries share one key while unrelated messages stay distinct.
 */
export function normalizeStatusKey(message) {
  return message.replace(/\d+\s*\/\s*\d+/g, '').replace(/\battempt\s*\d+\s*$/i, 'attempt').replace(/\s+/g, ' ').trim();
}

/**
 * Render an unknown wire payload type for humans (`session.foo_bar.observed`
 * becomes `session foo bar observed`) instead of echoing the dotted name.
 */
function humanizePayloadType(payloadType) {
  return String(payloadType).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
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
