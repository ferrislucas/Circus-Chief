const MAX_LINE_BYTES = 1024 * 1024;

export function createMuseExecProtocol({ maxLineBytes = MAX_LINE_BYTES } = {}) {
  let buffer = '';
  let sequence = -1;
  let terminal = false;
  const parseLine = (line) => {
    if (!line.trim()) return [];
    const record = parseProtocolRecord(line);
    if (record.sequence <= sequence) throw new Error('Muse exec JSONL sequence was duplicated or out of order.');
    sequence = record.sequence;
    if (record.payload_type.startsWith('run.terminal.')) {
      if (terminal) throw new Error('Muse exec emitted more than one terminal record.');
      terminal = true;
      return [mapTerminalEvent(record.payload_type, record.payload)];
    }
    const event = mapPayloadEvent(record.payload_type, record.payload);
    return event ? [event] : [];
  };
  return {
    push(chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (Buffer.byteLength(buffer) > maxLineBytes && !buffer.includes('\n')) throw new Error('Muse exec JSONL line exceeded the safety limit.');
      const lines = buffer.split('\n'); buffer = lines.pop();
      return lines.flatMap((line) => parseLine(line.endsWith('\r') ? line.slice(0, -1) : line));
    },
    end() {
      if (buffer.trim()) throw new Error('Muse exec closed stdout with an incomplete JSONL record.');
      return [];
    },
  };
}

function parseProtocolRecord(line) {
  let record;
  try { record = JSON.parse(line); } catch { throw new Error('Muse exec emitted invalid JSONL.'); }
  if (!record || typeof record !== 'object' || record.schema_version !== 1 || record.record_type !== 'event'
    || typeof record.sequence !== 'number' || typeof record.payload_type !== 'string' || !record.payload || typeof record.payload !== 'object') {
    throw new Error('Muse exec emitted an unsupported protocol record.');
  }
  return record;
}

function mapPayloadEvent(type, payload) {
  if (type === 'runtime.command.accepted') return { kind: 'accepted', commandId: safe(payload.command_id) };
  if (type === 'run.lifecycle.started') return { kind: 'started' };
  if (type === 'run.output.delta') return typeof payload.text === 'string' ? { kind: 'text', text: payload.text } : null;
  if (type.startsWith('task.lifecycle.')) {
    return { kind: 'progress', phase: type.slice('task.lifecycle.'.length), taskKind: safe(payload.task_kind) };
  }
  return { kind: 'unknown', payloadType: type };
}

function mapTerminalEvent(type, payload) {
  if (type === 'run.terminal.completed' && payload.terminal === 'completed') {
    return {
      kind: 'terminal',
      outcome: 'completed',
      text: typeof payload.text === 'string' ? payload.text.trim() : '',
      reason: safe(payload.reason),
    };
  }
  if (type === 'run.terminal.cancelled') return { kind: 'terminal', outcome: 'cancelled', reason: safe(payload.reason) };
  if (type === 'run.terminal.failed') return { kind: 'terminal', outcome: 'failed', reason: safe(payload.reason) };
  throw new Error(`Muse exec emitted unsupported terminal event: ${type}.`);
}

function safe(value) { return typeof value === 'string' ? value.slice(0, 240) : null; }
