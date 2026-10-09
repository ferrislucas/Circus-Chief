const MAX_RECORD_BYTES = 1024 * 1024;
const DIAGNOSTIC_RECORD_LIMIT = 20;
const RECORD_TYPES = new Set(['reconciliation', 'event', 'status']);

/** Parses the current Muse exec JSON object stream for one command invocation. */
export function createMuseExecProtocol({ maxRecordBytes = MAX_RECORD_BYTES, onDiagnostic } = {}) {
  let buffer = '';
  let sequence = -1;
  let commandId = null;
  let runId = null;
  let terminal = null;
  const diagnostics = [];
  const recordDiagnostic = (record) => {
    const entry = {
      sequence: record.sequence,
      recordType: record.record_type,
      payloadType: record.payload_type,
      eventId: eventIdentifier(record),
      commandId: identifier(record.payload.command_id),
      runId: identifier(record.payload.run_stream?.id),
      terminal: terminalOutcome(record.payload_type, record.payload),
    };
    diagnostics.push(entry);
    if (diagnostics.length > DIAGNOSTIC_RECORD_LIMIT) diagnostics.shift();
  };
  const fail = (message) => {
    const error = new Error(message);
    // Safe metadata only: it is for server logs and deliberately excluded from UI results.
    error.museDiagnostics = diagnostics.slice();
    onDiagnostic?.(error.museDiagnostics, message);
    throw error;
  };
  const trackAcceptedCommand = (record) => {
    if (record.payload_type !== 'runtime.command.accepted') return;
    const acceptedId = requiredIdentifier(record.payload.command_id);
    if (!acceptedId) fail('Muse exec accepted a command without a command id.');
    // One exec invocation can accept follow-up commands after our turn (e.g. an
    // inbox-drain run delivering a background task result). The first accepted
    // command owns this turn; later ones are CLI-internal and ignored, matching
    // how foreign linked runs and terminals are already skipped below.
    if (!commandId) commandId = acceptedId;
  };
  const trackLinkedRun = (record) => {
    if (record.payload_type !== 'session.run.linked') return;
    const linkedCommandId = requiredIdentifier(record.payload.command_id);
    const linkedRunId = requiredIdentifier(record.payload.run_stream?.id);
    if (!linkedCommandId || !linkedRunId) fail('Muse exec linked a run without command and run identifiers.');
    // Reconciliation can include historical linked runs. Only our accepted command owns one.
    if (commandId && linkedCommandId === commandId) {
      if (runId && runId !== linkedRunId) fail('Muse exec emitted conflicting linked run ids.');
      runId = linkedRunId;
    }
  };
  const parseRecord = (json) => {
    const record = parseProtocolRecord(json);
    recordDiagnostic(record);
    if (record.sequence <= sequence) fail('Muse exec JSONL sequence was duplicated or out of order.');
    sequence = record.sequence;
    trackAcceptedCommand(record);
    trackLinkedRun(record);
    if (record.payload_type.startsWith('run.terminal.')) return mapOwnedTerminal(record, { commandId, runId, terminal, fail, setTerminal: (value) => { terminal = value; } });
    const event = mapPayloadEvent(record.payload_type, record.payload);
    return event ? [event] : [];
  };
  return {
    push(chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const records = extractJsonObjects({ buffer, maxRecordBytes, fail });
      buffer = records.remainder;
      return records.values.flatMap(parseRecord);
    },
    end() {
      if (buffer.trim()) fail('Muse exec closed stdout with an incomplete JSON record.');
      return [];
    },
  };
}

/**
 * Muse 1.4.2 can write adjacent JSON objects in a single stdout chunk. JSONL
 * splitting therefore loses framing; scan complete object boundaries instead.
 */
function extractJsonObjects({ buffer, maxRecordBytes, fail }) {
  const values = [];
  let offset = 0;
  while (offset < buffer.length) {
    while (offset < buffer.length && /\s/.test(buffer[offset])) offset += 1;
    if (offset === buffer.length) return { values, remainder: '' };
    if (buffer[offset] !== '{') fail('Muse exec emitted invalid JSON object framing.');

    const completeAt = scanRecordEnd(buffer, offset, { maxRecordBytes, fail });
    if (completeAt === -1) {
      return { values, remainder: buffer.slice(offset) };
    }
    values.push(buffer.slice(offset, completeAt + 1));
    offset = completeAt + 1;
  }
  return { values, remainder: '' };
}

function scanRecordEnd(buffer, offset, { maxRecordBytes, fail }) {
  let state = { depth: 0, inString: false, escaped: false };
  let recordBytes = 0;
  for (let index = offset; index < buffer.length; index += 1) {
    const character = buffer[index];
    // Counting UTF-16 code units separately can only over-count surrogate
    // pairs, which is safe for this upper bound and keeps scanning linear.
    recordBytes += Buffer.byteLength(character);
    if (recordBytes > maxRecordBytes) fail('Muse exec JSON record exceeded the safety limit.');
    const step = consumeRecordCharacter(state, character, fail);
    state = step.state;
    if (step.complete) return index;
  }
  return -1;
}

function consumeRecordCharacter(state, character, fail) {
  if (state.inString) return { state: consumeStringCharacter(state, character), complete: false };
  if (character === '"') return { state: { ...state, inString: true }, complete: false };
  if (character === '{') return { state: { ...state, depth: state.depth + 1 }, complete: false };
  if (character !== '}') return { state, complete: false };
  return consumeClosingBrace(state, fail);
}

function consumeStringCharacter(state, character) {
  if (state.escaped) return { ...state, escaped: false };
  if (character === '\\') return { ...state, escaped: true };
  if (character === '"') return { ...state, inString: false };
  return state;
}

function consumeClosingBrace(state, fail) {
  const depth = state.depth - 1;
  if (depth === 0) return { state, complete: true };
  if (depth < 0) fail('Muse exec emitted invalid JSON object framing.');
  return { state: { ...state, depth }, complete: false };
}

function mapOwnedTerminal(record, state) {
  const terminalCommandId = requiredIdentifier(record.payload.command_id);
  const terminalRunId = requiredIdentifier(record.payload.run_stream?.id);
  if (!terminalCommandId || !terminalRunId) state.fail('Muse exec terminal record is missing command or run ownership identifiers.');
  // Fully identified terminals for another invocation are normal reconciliation data.
  if (!state.commandId || terminalCommandId !== state.commandId) return [];
  if (!state.runId) state.fail('Muse exec emitted a terminal before linking the active command run.');
  if (terminalRunId !== state.runId) return [];
  let mapped;
  try { mapped = mapTerminalEvent(record.payload_type, record.payload); } catch (error) { state.fail(error.message); }
  const candidate = { ...mapped, eventId: eventIdentifier(record) };
  if (!state.terminal) {
    state.setTerminal(candidate);
    return [mapped];
  }
  if (sameTerminal(state.terminal, candidate)) return [];
  state.fail('Muse exec emitted conflicting terminal records for the active command run.');
}

function sameTerminal(left, right) {
  return (left.eventId && left.eventId === right.eventId)
    || (left.outcome === right.outcome && left.text === right.text && left.reason === right.reason);
}

function parseProtocolRecord(json) {
  let record;
  try { record = JSON.parse(json); } catch { throw new Error('Muse exec emitted invalid JSON.'); }
  if (!record || typeof record !== 'object' || record.schema_version !== 1 || !RECORD_TYPES.has(record.record_type)
    || typeof record.sequence !== 'number' || typeof record.payload_type !== 'string' || !record.payload || typeof record.payload !== 'object') {
    throw new Error('Muse exec emitted an unsupported protocol record.');
  }
  return record;
}

function mapPayloadEvent(type, payload) {
  if (type === 'runtime.command.accepted') return { kind: 'accepted', commandId: safe(payload.command_id) };
  if (type === 'run.lifecycle.started') return { kind: 'started' };
  if (type === 'run.output.delta') return typeof payload.text === 'string' ? { kind: 'text', text: payload.text } : null;
  if (type === 'tool.result') return mapToolResultPayload(payload);
  // task.lifecycle.status carries the only human-readable progress messages
  // ("opening meta model stream attempt 1/10"); task.lifecycle.output carries
  // tool output chunks. Both are forwarded so the mapper can surface them.
  if (type === 'task.lifecycle.status') return mapStatusPayload(payload);
  if (type === 'task.lifecycle.output') return mapOutputPayload(payload);
  if (type.startsWith('task.lifecycle.')) return { kind: 'progress', phase: type.slice('task.lifecycle.'.length), ...taskIdentity(payload) };
  return { kind: 'unknown', payloadType: type };
}

// Tool results carry the human-readable outcome ("wrote N bytes…",
// "Read text file…", or exec JSON with command/description/exit_code).
// Bounded here so one huge tool dump cannot grow memory without limit.
// The owning task id lets the mapper match output chunks against the
// tool_result that supersedes them (FR-8 orphan flush).
function mapToolResultPayload(payload) {
  const taskId = identifier(payload?.event?.task_id ?? payload?.task_id);
  // Forward the CLI-supplied tool identity (event field wins, top-level
  // fallback) so the mapper's `event.tool_name || 'Muse'` badge resolves to
  // a real tool. Bounded like the other forwarded identifiers; absent stays
  // undefined and the mapper still badges 'Muse'.
  const toolName = safe(payload?.event?.tool_name ?? payload?.tool_name) ?? undefined;
  return typeof payload.text === 'string' ? { kind: 'tool_result', text: bounded(payload.text, 8000), taskId, ...(toolName ? { tool_name: toolName } : {}) } : null;
}

function mapStatusPayload(payload) {
  const message = typeof payload?.event?.message === 'string' ? bounded(payload.event.message, 500) : null;
  return { kind: 'progress', phase: 'status', ...taskIdentity(payload), message };
}

function mapOutputPayload(payload) {
  const chunk = typeof payload?.event?.chunk === 'string' ? bounded(payload.event.chunk, 4000) : null;
  return { kind: 'progress', phase: 'output', ...taskIdentity(payload), chunk };
}

/**
 * Identify the task a lifecycle record belongs to. The CLI always leaves
 * top-level `task_kind` null; the real kind arrives on the `proposed`
 * event, so the event field wins with a top-level fallback. Both stay
 * bounded like the other forwarded identifiers.
 */
function taskIdentity(payload) {
  const event = payload?.event;
  return {
    taskKind: safe(event?.task_kind ?? payload?.task_kind),
    taskId: identifier(event?.task_id ?? payload?.task_id),
  };
}

function mapTerminalEvent(type, payload) {
  const outcome = type.slice('run.terminal.'.length);
  if (!['completed', 'cancelled', 'failed'].includes(outcome) || payload.terminal !== outcome) {
    throw new Error(`Muse exec emitted unsupported terminal event: ${type}.`);
  }
  return {
    kind: 'terminal', outcome,
    ...(outcome === 'completed' ? { text: typeof payload.text === 'string' ? payload.text.trim() : '' } : {}),
    reason: safe(payload.reason),
  };
}

function terminalOutcome(type, payload) {
  return type.startsWith('run.terminal.') && typeof payload.terminal === 'string' ? payload.terminal.slice(0, 40) : null;
}
function requiredIdentifier(value) { return typeof value === 'string' && value.trim() ? value.slice(0, 240) : null; }
function identifier(value) { return requiredIdentifier(value); }
function eventIdentifier(record) { return identifier(record.id ?? record.event_id ?? record.payload?.event_id); }
function safe(value) { return typeof value === 'string' ? value.slice(0, 240) : null; }
function bounded(value, max) { return typeof value === 'string' && value.length > max ? `${value.slice(0, max)}… (truncated)` : value; }
