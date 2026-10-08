import { describe, expect, it } from 'vitest';
import { createMuseExecProtocol } from './museExecProtocol.js';
import { createMuseExecEventMapper } from './museExecEventMapper.js';

/**
 * Shared echo-turn fixture (FRD criterion 1 regression net).
 *
 * Replays the recorded `muse exec --json --provider echo` turn shape in
 * order through the real protocol parser + event mapper: accepted command,
 * linked run, model config, user input, four internal tasks (each with
 * mechanical records carrying `event.task_kind` only on `proposed`), two
 * interleaved model-stream status attempts, one output delta, and the
 * completed terminal. Goes green incrementally as Phases 1–5 land and must
 * be green at Phase 9.
 */
export function buildEchoTurnRecords() {
  const records = [];
  let sequence = 0;
  const record = (payload_type, payload, record_type = 'event') => {
    sequence += 1;
    records.push(JSON.stringify({ schema_version: 1, record_type, sequence, payload_type, payload }));
  };
  record('runtime.command.accepted', { command_id: 'cmd-echo' });
  record('session.run.linked', { command_id: 'cmd-echo', run_stream: { id: 'run-echo' } });
  record('run.model.configured', { command_id: 'cmd-echo' });
  record('turn.input.user', { command_id: 'cmd-echo' });
  record('session.workspace_branch.observed', { command_id: 'cmd-echo' });
  const tasks = [
    { id: 'task-1', kind: 'reminder.agent.skill-reminder' },
    { id: 'task-2', kind: 'reminder.agent.verify-reminder' },
    { id: 'task-3', kind: 'model.unknown.response' },
    { id: 'task-4', kind: 'model.response' },
  ];
  const lifecycle = (taskId, phase, extraEvent = {}) => record(`task.lifecycle.${phase}`, {
    kind: 'task_lifecycle', task_kind: null, task_id: taskId, event: { kind: phase, task_id: taskId, ...extraEvent },
  });
  record('task.stream.linked', { command_id: 'cmd-echo' });
  tasks.forEach(({ id, kind }) => {
    // The CLI leaves top-level task_kind null; the real kind lives only on
    // the proposed event — that is the shape FR-1/FR-2 must handle.
    lifecycle(id, 'proposed', { task_kind: kind });
    lifecycle(id, 'accepted');
    lifecycle(id, 'scheduled');
    lifecycle(id, 'side_effect_intent');
    if (id === 'task-1') {
      lifecycle('task-3', 'status', { message: 'opening meta model stream attempt 1/10' });
    }
    lifecycle(id, 'started');
    if (id === 'task-2') {
      lifecycle('task-3', 'status', { message: 'opening meta model stream attempt 2/10' });
    }
    lifecycle(id, 'completed');
  });
  record('run.output.delta', { command_id: 'cmd-echo', text: 'echo response' });
  record('run.terminal.completed', {
    command_id: 'cmd-echo', run_stream: { id: 'run-echo' }, terminal: 'completed', text: 'echo response', reason: null,
  });
  return records;
}

/** Collect persisted work-log rows (tool_result notices) from mapped events. */
function collectNotices(notices, mapped) {
  for (const event of mapped) {
    if (event.type === 'tool_result' && typeof event.content === 'string') notices.push(event.content);
  }
}

/** Push every fixture record through a fresh protocol parser + mapper; return emitted notice contents. */
export function replayEchoTurn() {
  const parser = createMuseExecProtocol();
  const mapper = createMuseExecEventMapper({});
  const notices = [];
  for (const line of buildEchoTurnRecords()) {
    for (const item of parser.push(`${line}\n`)) {
      // Like MuseExecAdapter, flushed rows (collapsed retries, orphaned
      // output) ride on final()'s return value — collect them as notices.
      collectNotices(notices, item.kind === 'terminal' ? mapper.final(item) : mapper.map(item));
    }
  }
  expect(parser.end()).toEqual([]);
  return notices;
}

describe('muse echo-turn fixture (FRD criterion 1)', () => {
  it('emits no unlabeled, reminder, or raw wire-name rows and at most two rows per status group', () => {
    const notices = replayEchoTurn();
    expect(notices.filter((content) => content.includes('Muse task work:'))).toEqual([]);
    expect(notices.filter((content) => /reminder\./.test(content))).toEqual([]);
    expect(notices.filter((content) => content.startsWith('Muse progress:'))).toEqual([]);
    // Emit-first-then-coalesce: the first attempt signal streams live
    // mid-turn and the collapsed latest text follows — at most two rows per
    // group (first + latest-if-different), not exactly one.
    const attempts = notices.filter((content) => content.includes('attempt'));
    expect(attempts).toEqual(['opening meta model stream attempt 1/10', 'opening meta model stream attempt 2/10']);
  });
});
