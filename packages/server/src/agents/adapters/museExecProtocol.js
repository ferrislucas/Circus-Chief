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
  const parseRecord = (json) => {
    const record = parseProtocolRecord(json);
    recordDiagnostic(record);
    if (record.sequence <= sequence) fail('Muse exec JSONL sequence was duplicated or out of order.');
    sequence = record.sequence;

    if (record.payload_type === 'runtime.command.accepted') {
      const acceptedId = requiredIdentifier(record.payload.command_id);
      if (!acceptedId) fail('Muse exec accepted a command without a command id.');
      if (commandId && commandId !== acceptedId) fail('Muse exec emitted conflicting accepted command ids.');
      commandId = acceptedId;
    }

    if (record.payload_type === 'session.run.linked') {
      const linkedCommandId = requiredIdentifier(record.payload.command_id);
      const linkedRunId = requiredIdentifier(record.payload.run_stream?.id);
      if (!linkedCommandId || !linkedRunId) fail('Muse exec linked a run without command and run identifiers.');
      // Reconciliation can include historical linked runs. Only our accepted command owns one.
      if (commandId && linkedCommandId === commandId) {
        if (runId && runId !== linkedRunId) fail('Muse exec emitted conflicting linked run ids.');
        runId = linkedRunId;
      }
    }

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

    let depth = 0; let inString = false; let escaped = false; let completeAt = -1; let recordBytes = 0;
    for (let index = offset; index < buffer.length; index += 1) {
      const character = buffer[index];
      // Counting UTF-16 code units separately can only over-count surrogate
      // pairs, which is safe for this upper bound and keeps scanning linear.
      recordBytes += Buffer.byteLength(character);
      if (recordBytes > maxRecordBytes) fail('Muse exec JSON record exceeded the safety limit.');
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) { completeAt = index; break; }
        if (depth < 0) fail('Muse exec emitted invalid JSON object framing.');
      }
    }
    if (completeAt === -1) {
      return { values, remainder: buffer.slice(offset) };
    }
    values.push(buffer.slice(offset, completeAt + 1));
    offset = completeAt + 1;
  }
  return { values, remainder: '' };
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
  if (type.startsWith('task.lifecycle.')) return { kind: 'progress', phase: type.slice('task.lifecycle.'.length), taskKind: safe(payload.task_kind) };
  return { kind: 'unknown', payloadType: type };
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
