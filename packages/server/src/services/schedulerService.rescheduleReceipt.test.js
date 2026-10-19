/**
 * Regression: scheduler-claimed retries must not wipe their own reschedule.
 *
 * A turn that fails with a reschedulable error ends via _executeSession /
 * handleTerminalStreamError returning a receipt. finishScheduledStart
 * validates that receipt with didSessionExecutionStart(result, session.id),
 * which requires result.sessionId === session.id. The receipts used to omit
 * sessionId ({ started: true, outcome: 'rescheduled' }), so every
 * scheduler-claimed retry that ended rescheduled was classified as an
 * invalid executor response and rejectScheduledStart wiped the just-committed
 * reschedule (status -> stopped, schedule cleared, everything else preserved)
 * — silently terminating the retry chain (workspace 91a5cf stall,
 * 2026-10-18). These tests pin the fixed receipt contract against the exact
 * production sequence.
 */
import { describe, expect, it } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions, messages } from '../database.js';
import { SchedulerService } from './schedulerService.js';
import { attachRootSession, createLaneRunForEntry, markExecutionState } from './workflowSessionService.js';

function setupScheduledLaneWorker() {
  const project = projects.create('Reschedule receipt project', '/tmp/reschedule-receipt');
  const board = kanbanBoards.create(project.id);
  const [source, target] = kanbanLanes.getByBoardId(board.id);
  const workspace = sessions.create(project.id, 'Workspace', 'work');
  const card = kanbanCards.create(source.id, workspace.id);
  const worker = sessions.create(project.id, 'Automated worker', 'complete the lane', {
    parentSessionId: workspace.id,
  });
  const run = createLaneRunForEntry({
    projectId: project.id,
    workspaceId: workspace.id,
    cardId: card.id,
    lane: { ...source, onEnterPrompt: 'complete the lane', completionTargetLaneId: target.id },
  });
  attachRootSession(run.id, worker.id);

  // The turn has run before (first failure already rescheduled once) — the
  // state the poller finds when it claims retry #2.
  messages.create(worker.id, 'user', 'Continue', { toolUse: null });
  messages.create(worker.id, 'assistant', 'partial work', { toolUse: null });
  sessions.update(worker.id, {
    status: 'scheduled',
    scheduledAt: Date.now(),
    pendingPrompt: 'Continue',
    rescheduleCount: 1,
    error: 'Rescheduled (1x): usage limit',
  });
  return { worker, run };
}

/** Replay what the real continuation core does when a claimed retry fails
 * with a reschedulable error: commit reschedule #2, mark retrying, then
 * resolve with the (fixed) executor receipt. */
function makeReschedulingExecutor(failCount = 2) {
  return async (sessionId) => {
    sessions.update(sessionId, {
      status: 'scheduled',
      scheduledAt: Date.now() + 15 * 60 * 1000,
      rescheduleCount: failCount,
      pendingPrompt: 'Continue',
      error: `Rescheduled (${failCount}x): You've hit your usage limit…`,
    });
    markExecutionState(sessionId, 'retrying');
    return { started: true, sessionId, outcome: 'rescheduled' };
  };
}

describe('SchedulerService rescheduled-retry receipt contract', () => {
  it('keeps the reschedule a scheduler-claimed lane-worker retry just committed', async () => {
    const { worker, run } = setupScheduledLaneWorker();
    const scheduler = new SchedulerService();
    scheduler.initialize({
      isSessionActive: () => false,
      continueSession: makeReschedulingExecutor(),
    });

    const result = await scheduler.startScheduledSession(sessions.getById(worker.id));

    // The turn ran: the receipt (with sessionId) is accepted and surfaced
    // (finishScheduledStart normalizes to startedSessionExecution).
    expect(result).toEqual({ claimed: true, started: true, sessionId: worker.id });

    // …and the retry it committed survives — no rejectScheduledStart wipe.
    const final = sessions.getById(worker.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.pendingPrompt).toBe('Continue');
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
    expect(final.rescheduleCount).toBe(2);
    expect(final.executionState).toBe('retrying');
    expect(final.ownWorkState).toBe('open');
    expect(final.laneRunId).toBe(run.id);
  });

  it('keeps the reschedule for a scheduler-claimed non-lane retry too', async () => {
    // finishScheduledStart only fabricates receipts for undefined results,
    // so a non-lane scheduled session is exposed to the same contract.
    const project = projects.create('Reschedule receipt project (plain)', '/tmp/reschedule-receipt-plain');
    const session = sessions.create(project.id, 'Plain session', 'do work');
    messages.create(session.id, 'user', 'Continue', { toolUse: null });
    messages.create(session.id, 'assistant', 'partial work', { toolUse: null });
    sessions.update(session.id, {
      status: 'scheduled',
      scheduledAt: Date.now(),
      pendingPrompt: 'Continue',
      rescheduleCount: 1,
      error: 'Rescheduled (1x): service error',
    });

    const scheduler = new SchedulerService();
    scheduler.initialize({
      isSessionActive: () => false,
      continueSession: makeReschedulingExecutor(),
    });

    const result = await scheduler.startScheduledSession(sessions.getById(session.id));
    // Non-lane scheduled starts resolve to the bare claimed receipt on success.
    expect(result).toEqual({ claimed: true });

    const final = sessions.getById(session.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.rescheduleCount).toBe(2);
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
  });
});
