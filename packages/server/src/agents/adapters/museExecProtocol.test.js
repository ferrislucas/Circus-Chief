import { describe, expect, it } from 'vitest';
import { createMuseExecProtocol } from './museExecProtocol.js';

const record = (sequence, payload_type, payload) => JSON.stringify({ schema_version: 1, record_type: 'event', sequence, payload_type, payload });

describe('muse exec protocol', () => {
  it('buffers split JSONL records and recognizes a completed terminal', () => {
    const parser = createMuseExecProtocol();
    const line = `${record(1, 'run.terminal.completed', { terminal: 'completed', text: 'Done' })}\n`;
    expect(parser.push(line.slice(0, 12))).toEqual([]);
    expect(parser.push(line.slice(12))).toEqual([{ kind: 'terminal', outcome: 'completed', text: 'Done', reason: null }]);
    expect(parser.end()).toEqual([]);
  });

  it('rejects a completed terminal without valid envelope order', () => {
    const parser = createMuseExecProtocol();
    parser.push(`${record(2, 'run.lifecycle.started', {})}\n`);
    expect(() => parser.push(`${record(1, 'run.terminal.completed', { terminal: 'completed', text: 'x' })}\n`)).toThrow(/out of order/);
  });
});
