import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseManager, kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, attachRootSession, reconcileLaneRun,
  supersedeRunForCard, declareExitLane, closeOwnWork, markExecutionState, markHeldForLimit,
  computeSubtreeOutcome, recomputeSubtreeOutcomes, attemptLaneRunTransition,
} from './workflowSessionService.js';
import { auditKanbanInvariants, reconcileKanbanOwnership } from './kanbanRecoveryService.js';

describe('workflowSessionService', () => {
  let project; let board; let source; let target; let root; let card;

  beforeEach(() => {
    project = projects.create('Workflow project', '/tmp/workflow');
    board = kanbanBoards.create(project.id);
    [source, target] = kanbanLanes.getByBoardId(board.id);
    root = sessions.create(project.id, 'Root', 'work');
    card = kanbanCards.create(source.id, root.id);
  });

  function structuredLane() {
    return { ...kanbanLanes.getById(source.id), onEnterPrompt: 'Perform lane work', completionTargetLaneId: target.id };
  }

  it('advances when the server finalizes a successful turn without an agent callback', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    expect(getRun(run.id).rootSessionId).toBe(worker.id);
    expect(sessions.getById(root.id).laneRunId).toBeNull();
    const token = beginWorkflowTurn(worker.id);
    expect(finalizeOwnWorkCompletion(worker.id, token).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(getRun(run.id).openCount).toBe(0);
  });

  it('reports invalid target-only lanes without blocking valid-project reconciliation', () => {
    databaseManager.get().prepare('UPDATE kanban_lanes SET completion_target_lane_id=? WHERE id=?').run(target.id, source.id);
    const report = auditKanbanInvariants();
    expect(report.ok).toBe(false);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'invalid_lane', laneId: source.id }),
    ]));
    expect(reconcileKanbanOwnership({ dryRun: false })).toEqual(expect.objectContaining({ blocked: false, applied: true }));
  });

  it('preserves a user-scheduled board session that never belonged to a lane run', () => {
    sessions.update(root.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'old worker' });
    const first = reconcileKanbanOwnership({ dryRun: false });
    expect(first.changes).toEqual([]);
    expect(sessions.getById(root.id)).toEqual(expect.objectContaining({
      scheduledAt: expect.any(Number), pendingPrompt: 'old worker',
    }));
    expect(reconcileKanbanOwnership({ dryRun: false }).changes).toEqual([]);
  });

  it('supersedes a rootless open run without a resumable completion handoff', () => {
    const run = createLaneRunForEntry({
      projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane(),
    });

    const recovery = reconcileKanbanOwnership({ dryRun: false });

    expect(getRun(run.id).status).toBe('superseded');
    expect(recovery.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'superseded_runs', runIds: [run.id] }),
    ]));
  });

  it('keeps scheduled work open even with a valid completion request', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);
    sessions.update(worker.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
    expect(finalizeOwnWorkCompletion(worker.id, token)).toBeNull();
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });

  it('treats a plain turn end without a continuation as own work done', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    beginWorkflowTurn(worker.id);

    finalizeOwnWorkCompletion(worker.id);

    expect(sessions.getById(worker.id).ownWorkState).toBe('closed_successfully');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
  });

  it('inherits the run atomically for descendants and waits for them', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const child = sessions.create(project.id, 'Child', 'child work', { parentSessionId: worker.id });
    expect(sessions.getById(child.id).laneRunId).toBe(run.id);

    const rootToken = beginWorkflowTurn(worker.id);
    expect(finalizeOwnWorkCompletion(worker.id, rootToken).status).toBe('open');
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });

  it('clears the active run after success without a completion target', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({
      projectId: project.id, workspaceId: root.id, cardId: card.id,
      lane: { ...structuredLane(), completionTargetLaneId: null },
    });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);

    expect(finalizeOwnWorkCompletion(worker.id, token).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
  });

  it('fails a run without moving its card when a participating member permanently fails', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    databaseManager.get().prepare("UPDATE sessions SET own_work_state='closed_failed', workflow_reason=? WHERE id=?")
      .run('permanent provider error', worker.id);

    expect(reconcileLaneRun(run.id).status).toBe('failed');
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });

  describe('closeOwnWork (W4: FR-9 failure/cancellation propagation)', () => {
    it('fails the run and does not move the card on a permanent execution failure (AC-8)', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      beginWorkflowTurn(worker.id);

      const reconciled = closeOwnWork(worker.id, 'closed_failed', 'permanent provider error');

      expect(reconciled.status).toBe('failed');
      expect(sessions.getById(worker.id).ownWorkState).toBe('closed_failed');
      expect(sessions.getById(worker.id).workflowReason).toBe('permanent provider error');
      expect(sessions.getById(worker.id).executionState).toBe('stopped');
      expect(sessions.getById(worker.id).subtreeOutcome).toBe('failed');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
    });

    it('cancels the run and does not move the card on a user stop', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      beginWorkflowTurn(worker.id);

      const reconciled = closeOwnWork(worker.id, 'cancelled', 'Stopped by user');

      expect(reconciled.status).toBe('cancelled');
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
    });

    it('is idempotent: a second call after the first close is a no-op', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      beginWorkflowTurn(worker.id);
      closeOwnWork(worker.id, 'closed_failed', 'first reason');

      const result = closeOwnWork(worker.id, 'cancelled', 'second reason (should not apply)');

      expect(result).toBeNull();
      expect(sessions.getById(worker.id).ownWorkState).toBe('closed_failed');
      expect(sessions.getById(worker.id).workflowReason).toBe('first reason');
    });

    it('is a no-op for a non-participating session', () => {
      const plain = sessions.create(project.id, 'Plain', 'unrelated work');
      expect(closeOwnWork(plain.id, 'closed_failed', 'irrelevant')).toBeNull();
      expect(sessions.getById(plain.id).ownWorkState).toBe('open');
    });

    it('a transient error that keeps the session open never touches own_work_state (AC-7 contrast)', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      beginWorkflowTurn(worker.id);

      // Simulates sessionExecution.js's rescheduled branch: only execution_state moves.
      markExecutionState(worker.id, 'retrying');

      expect(sessions.getById(worker.id).ownWorkState).toBe('open');
      expect(sessions.getById(worker.id).executionState).toBe('retrying');
      expect(getRun(run.id).status).toBe('open');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
    });
  });

  it('markExecutionState is a no-op for a non-participating session', () => {
    const plain = sessions.create(project.id, 'Plain', 'unrelated work');
    markExecutionState(plain.id, 'retrying');
    expect(sessions.getById(plain.id).executionState).toBe('idle');
  });

  describe('markHeldForLimit (FR-9.8)', () => {
    function participatingWorker() {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      return { worker, run };
    }

    it('pauses an open, unscheduled participating session and exposes it as the blocker', () => {
      const { worker, run } = participatingWorker();

      expect(markHeldForLimit(worker.id)).toBe(true);
      expect(sessions.getById(worker.id).executionState).toBe('paused');
      expect(getRun(run.id)).toEqual(expect.objectContaining({
        pausedCount: 1,
        blockingSessionId: worker.id,
        blockingReason: 'Paused — provider limit or outage',
      }));
    });

    it('does not overwrite closed, scheduled, or non-participating work', () => {
      const { worker } = participatingWorker();
      sessions.update(worker.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
      expect(markHeldForLimit(worker.id)).toBe(false);
      expect(sessions.getById(worker.id).executionState).not.toBe('paused');

      const plain = sessions.create(project.id, 'Plain', 'unrelated work');
      expect(markHeldForLimit(plain.id)).toBe(false);
      expect(sessions.getById(plain.id).executionState).toBe('idle');
    });

    it('keeps scheduled work ahead of paused work in blocker precedence', () => {
      const { worker, run } = participatingWorker();
      expect(markHeldForLimit(worker.id)).toBe(true);
      const scheduled = sessions.create(project.id, 'Scheduled', 'later', { parentSessionId: worker.id });
      sessions.update(scheduled.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
      expect(getRun(run.id)).toEqual(expect.objectContaining({
        blockingSessionId: scheduled.id,
        blockingReason: 'Waiting for scheduled work',
      }));
    });

    it('records a distinct audit event for each separately held turn', () => {
      const { worker, run } = participatingWorker();
      expect(markHeldForLimit(worker.id)).toBe(true);
      markExecutionState(worker.id, 'running');
      expect(markHeldForLimit(worker.id)).toBe(true);

      const audits = databaseManager.get().prepare(
        "SELECT event_type FROM kanban_lane_run_audit_events WHERE lane_run_id=? AND event_type='own_work_held_for_limit'"
      ).all(run.id);
      expect(audits).toHaveLength(2);
    });
  });

  it('W6: the synchronous DB transition moves the card but hands off target-lane automation via pendingTargetLaneTrigger', () => {
    // finalizeOwnWorkCompletion/attemptLaneRunTransition stay synchronous and
    // free of any dependency on kanbanService.js (see the import-cycle note on
    // attemptLaneRunTransition) — starting the target lane's on-enter session
    // is necessarily async and is the caller's job (sessionExecution.js calls
    // kanbanService.triggerStructuredTransitionAutomation with this value).
    kanbanLanes.update(target.id, { onEnterPrompt: 'perform target work' });
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);

    const reconciled = finalizeOwnWorkCompletion(worker.id, token);

    expect(reconciled.status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(reconciled.pendingTargetLaneTrigger).toEqual(expect.objectContaining({
      workspaceSessionId: root.id,
      targetLaneId: target.id,
      cardId: card.id,
      sourceRunId: run.id,
    }));
    const outbox = databaseManager.get().prepare('SELECT * FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(run.id);
    expect(outbox).toEqual(expect.objectContaining({ status: 'pending', lane_id: target.id, card_id: card.id }));
    const targetRun = databaseManager.get().prepare('SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(outbox.id);
    expect(targetRun).toEqual(expect.objectContaining({ source_lane_id: target.id, prior_lane_run_id: run.id, status: 'open' }));
    // No target-lane session exists yet — that only happens once the caller
    // acts on pendingTargetLaneTrigger.
    const sessionRows = databaseManager.get().prepare('SELECT id FROM sessions ORDER BY id').all();
    expect(sessionRows.map(({ id }) => id)).toEqual(expect.arrayContaining([root.id, worker.id]));
    expect(sessionRows).toHaveLength(2);
  });

  it('reconciles a succeeded-ready run without transitioning when allowTransition is false', () => {
    // Boot recovery (sessionStartupRecovery.js) calls closeOwnWork with
    // allowTransition:false so it can close obligations without moving cards or
    // creating successor runs ahead of the preflight audit. The
    // cancelled/failed outcomes recovery actually produces can never reach
    // attemptLaneRunTransition on their own, so force a 'succeeded' subtree
    // directly and assert the flag is what blocks the transition.
    kanbanLanes.update(target.id, { onEnterPrompt: 'perform target work' });
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_successfully',
      own_work_closed_at=?, execution_state='idle' WHERE id=?`).run(Date.now(), worker.id);

    // allowTransition:false reconciles the subtree but must not transition.
    expect(reconcileLaneRun(run.id, { allowTransition: false })).toEqual(expect.objectContaining({ status: 'open' }));
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
    expect(databaseManager.get().prepare(
      'SELECT count(*) count FROM kanban_lane_entry_events WHERE caused_by_run_id=?'
    ).get(run.id).count).toBe(0);

    // Default allowTransition:true then applies the guarded transition.
    expect(reconcileLaneRun(run.id).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(databaseManager.get().prepare(
      'SELECT count(*) count FROM kanban_lane_entry_events WHERE caused_by_run_id=?'
    ).get(run.id).count).toBe(1);
  });

  it.each([
    ['card move', `BEFORE UPDATE OF lane_id ON kanban_cards
      WHEN OLD.id='CARD_ID' AND NEW.lane_id='TARGET_ID'`],
    ['successor entry event', `BEFORE INSERT ON kanban_lane_entry_events
      WHEN NEW.caused_by_run_id='RUN_ID'`],
    ['successor lane run', `BEFORE INSERT ON kanban_lane_runs
      WHEN NEW.prior_lane_run_id='RUN_ID'`],
    ['successor ownership pointer', `BEFORE UPDATE OF active_lane_run_id ON kanban_cards
      WHEN OLD.id='CARD_ID' AND NEW.lane_id='TARGET_ID' AND NEW.active_lane_run_id<>'RUN_ID'`],
    ['transition audit', `BEFORE INSERT ON kanban_lane_run_audit_events
      WHEN NEW.lane_run_id='RUN_ID' AND NEW.event_type='transition_applied'`],
  ])('rolls back the entire completion transition when the %s write fails', (_boundary, triggerWhen) => {
    kanbanLanes.update(target.id, { onEnterPrompt: 'perform target work' });
    const run = createLaneRunForEntry({
      projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane(),
    });
    const db = databaseManager.get();
    const triggerSql = triggerWhen
      .replaceAll('CARD_ID', card.id)
      .replaceAll('TARGET_ID', target.id)
      .replaceAll('RUN_ID', run.id);
    db.exec(`CREATE TEMP TRIGGER fail_lane_transition ${triggerSql}
      BEGIN SELECT injected_transition_failure(); END`);

    try {
      expect(() => attemptLaneRunTransition(run.id)).toThrow('injected_transition_failure');
    } finally {
      db.exec('DROP TRIGGER fail_lane_transition');
    }

    expect(getRun(run.id)).toEqual(expect.objectContaining({ status: 'open', succeededAt: null }));
    expect(db.prepare('SELECT transition_applied_at FROM kanban_lane_runs WHERE id=?').get(run.id).transition_applied_at).toBeNull();
    expect(kanbanCards.getById(card.id)).toEqual(expect.objectContaining({
      laneId: source.id, activeLaneRunId: run.id,
    }));
    expect(db.prepare('SELECT id FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(run.id)).toBeUndefined();
    expect(db.prepare('SELECT id FROM kanban_lane_runs WHERE prior_lane_run_id=?').get(run.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM kanban_lane_run_audit_events WHERE lane_run_id=? AND event_type='transition_applied'").get(run.id))
      .toBeUndefined();
  });

  it('does not create an orphan entry event when completion moves into an unautomated lane', () => {
    const plainTarget = kanbanLanes.create(board.id, { name: 'Done' });
    const automatedSource = kanbanLanes.create(board.id, {
      name: 'Automated source', onEnterPrompt: 'work', completionTargetLaneId: plainTarget.id,
    });
    kanbanCards.moveToLane(card.id, automatedSource.id);
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: automatedSource });
    attachRootSession(run.id, worker.id);

    const reconciled = finalizeOwnWorkCompletion(worker.id, beginWorkflowTurn(worker.id));

    expect(reconciled.status).toBe('succeeded');
    expect(reconciled.pendingTargetLaneTrigger).toBeUndefined();
    expect(kanbanCards.getById(card.id)).toEqual(expect.objectContaining({ laneId: plainTarget.id, activeLaneRunId: null }));
    expect(databaseManager.get().prepare('SELECT * FROM kanban_lane_entry_events WHERE caused_by_run_id=?').get(run.id)).toBeUndefined();
  });

  it('W6: assigns the target-lane card a sort_order at the end of its existing cards', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    // Seed an existing card in the target lane so sort_order must land after it.
    const otherRootA = sessions.create(project.id, 'Other A', 'x');
    const existingTargetCard = kanbanCards.create(target.id, otherRootA.id, { sortOrder: 5 });

    const token = beginWorkflowTurn(worker.id);
    finalizeOwnWorkCompletion(worker.id, token);

    expect(kanbanCards.getById(card.id).sortOrder).toBeGreaterThan(existingTargetCard.sortOrder);
  });

  it('W6 (AC-12/AC-14): a run that is no longer open cannot be transitioned twice', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);
    finalizeOwnWorkCompletion(worker.id, token);

    // A second attempt against the now-succeeded run must be a pure no-op:
    // no pendingTargetLaneTrigger, no further card mutation.
    const second = attemptLaneRunTransition(run.id);
    expect(second.pendingTargetLaneTrigger).toBeUndefined();
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
  });

  it('does not open a transaction when superseding a legacy card without an active run', () => {
    const transaction = vi.spyOn(databaseManager, 'transaction');
    try {
      expect(supersedeRunForCard(card.id)).toBeNull();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });

  it('leaves no session scheduled after its lane run is superseded', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    sessions.update(worker.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
    databaseManager.get().prepare("UPDATE sessions SET status='scheduled' WHERE id=?").run(worker.id);

    supersedeRunForCard(card.id, 'manual_move');

    expect(sessions.getScheduledSessions()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: worker.id }),
    ]));
    expect(sessions.getById(worker.id)).toEqual(expect.objectContaining({
      status: 'stopped', executionState: 'stopped',
    }));
  });

  describe('deferred exits for an active lane run', () => {
    function runningWorker() {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      beginWorkflowTurn(worker.id);
      databaseManager.get().prepare("UPDATE sessions SET status='running' WHERE id=?").run(worker.id);
      return { worker, run };
    }

    it('leaves the worker running so its in-flight turn can finish', () => {
      const { worker, run } = runningWorker();

      expect(declareExitLane(card.id, target.id)).toEqual(expect.objectContaining({ status: 'open' }));

      // The whole point: the request that triggered this must not kill the
      // turn that issued it. Own work stays open for normal completion.
      const after = sessions.getById(worker.id);
      expect(after.status).toBe('running');
      expect(after.ownWorkState).toBe('open');
      expect(after.executionState).toBe('running');
      expect(getRun(run.id)).toEqual(expect.objectContaining({ status: 'open', chosenExitLaneId: target.id }));
    });

    it('lands waiting/idle when the turn completes, not stuck running', () => {
      const { worker } = runningWorker();
      declareExitLane(card.id, target.id);
      kanbanCards.moveToLane(card.id, target.id);

      finalizeOwnWorkCompletion(worker.id);

      const after = sessions.getById(worker.id);
      expect(after.ownWorkState).toBe('closed_successfully');
      expect(after.executionState).toBe('idle');
    });

    it('does not let the completion target override the declared lane', () => {
      const { worker, run } = runningWorker();
      declareExitLane(card.id, target.id);
      finalizeOwnWorkCompletion(worker.id);

      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
      expect(getRun(run.id).status).toBe('succeeded');
      expect(attemptLaneRunTransition(run.id).pendingTargetLaneTrigger).toBeUndefined();
    });

    it.each([
      ['closed_failed', 'provider error', 'failed'],
      ['cancelled', 'Stopped by user', 'cancelled'],
    ])('discards and audits a deferred exit when the run is %s', (outcome, reason, runStatus) => {
      const { worker, run } = runningWorker();
      declareExitLane(card.id, target.id);

      expect(closeOwnWork(worker.id, outcome, reason).status).toBe(runStatus);
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
      expect(getRun(run.id).chosenExitLaneId).toBe(target.id);
      expect(databaseManager.get().prepare(`SELECT session_id, details_json
        FROM kanban_lane_run_audit_events WHERE lane_run_id=? AND event_type='deferred_exit_discarded'`)
        .get(run.id)).toEqual({
        session_id: null,
        details_json: JSON.stringify({ targetLaneId: target.id, outcome: runStatus }),
      });
    });

    it('discards and audits a deferred exit when the run is superseded by a manual move', () => {
      const { run } = runningWorker();
      declareExitLane(card.id, target.id);

      supersedeRunForCard(card.id, 'manual_move');

      expect(getRun(run.id).status).toBe('superseded');
      expect(getRun(run.id).chosenExitLaneId).toBe(target.id);
      expect(databaseManager.get().prepare(`SELECT details_json
        FROM kanban_lane_run_audit_events WHERE lane_run_id=? AND event_type='deferred_exit_discarded'`)
        .get(run.id)).toEqual({
        details_json: JSON.stringify({ targetLaneId: target.id, outcome: 'superseded' }),
      });
    });

    it('recovers a declared exit after a crash before turn completion', () => {
      const { worker, run } = runningWorker();
      declareExitLane(card.id, target.id);

      // Simulate a process crash after the turn's own-work state was written
      // but before its in-process reconciliation callback could run.
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_successfully',
        own_work_closed_at=?, execution_state='idle' WHERE id=?`).run(Date.now(), worker.id);

      const recovery = reconcileKanbanOwnership({ dryRun: false });

      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
      expect(databaseManager.get().prepare('SELECT count(*) count FROM kanban_lane_entry_events WHERE caused_by_run_id=?')
        .get(run.id).count).toBe(0);
      expect(recovery.report.ok).toBe(true);
    });

    it('recovers an undeclared stuck run whose root reached the terminal state', () => {
      const { worker, run } = runningWorker();
      // No declareExitLane: completion_target_lane_id (target) is the only exit.

      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_successfully',
        own_work_closed_at=?, execution_state='idle' WHERE id=?`).run(Date.now(), worker.id);

      const recovery = reconcileKanbanOwnership({ dryRun: false });

      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
      expect(recovery.report.ok).toBe(true);
    });

    it('creates a successor run and a drainable entry event when the declared exit lane is structured', () => {
      const { worker, run } = runningWorker();
      // Make the target lane structured so a successor run must be created.
      kanbanLanes.update(target.id, { onEnterPrompt: 'validate the work' });
      declareExitLane(card.id, target.id);

      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_successfully',
        own_work_closed_at=?, execution_state='idle' WHERE id=?`).run(Date.now(), worker.id);

      const recovery = reconcileKanbanOwnership({ dryRun: false });

      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
      // A successor run exists and its entry event is pending for the retry worker.
      expect(databaseManager.get().prepare(`SELECT status FROM kanban_lane_entry_events
        WHERE caused_by_run_id=?`).get(run.id).status).toBe('pending');
      // The fresh successor must not be reported as an invariant violation.
      expect(recovery.report.ok).toBe(true);
    });

    it('rejects a same-lane reorder without completing or superseding the run', () => {
      const { worker, run } = runningWorker();

      expect(() => declareExitLane(card.id, source.id))
        .toThrow('exit lane must differ');

      expect(getRun(run.id).status).toBe('open');
      expect(sessions.getById(worker.id).ownWorkState).toBe('open');
    });

    it('does not interrupt an active child when declaring the root run exit', () => {
      const { worker, run } = runningWorker();
      const child = sessions.create(project.id, 'Child', 'child lane work', { parentSessionId: worker.id });
      databaseManager.get().prepare("UPDATE sessions SET status='running' WHERE id=?").run(child.id);

      expect(declareExitLane(card.id, target.id)).toEqual(expect.objectContaining({
        id: run.id,
        status: 'open',
        chosenExitLaneId: target.id,
      }));
      expect(sessions.getById(worker.id).status).toBe('running');
      expect(sessions.getById(child.id).status).toBe('running');
      expect(getRun(run.id).status).toBe('open');
    });

    it('rejects a declaration once there is no open active run', () => {
      const { worker } = runningWorker();
      closeOwnWork(worker.id, 'closed_failed', 'boom');

      expect(() => declareExitLane(card.id, target.id)).toThrow('no active lane run');
    });

    it('rejects a card with no active run', () => {
      expect(() => declareExitLane(card.id, target.id)).toThrow('no active lane run');
    });
  });

  it('marks a running member aborting when its run is superseded', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    beginWorkflowTurn(worker.id);
    databaseManager.get().prepare("UPDATE sessions SET status='running' WHERE id=?").run(worker.id);

    supersedeRunForCard(card.id, 'manual_move');

    const after = sessions.getById(worker.id);
    expect(after.status).toBe('running');
    expect(after.executionState).toBe('aborting');
  });

  it.each([
    { name: 'scheduled', status: 'scheduled', executionState: 'scheduled', expectedStatus: 'stopped' },
    { name: 'retrying', status: 'scheduled', executionState: 'retrying', expectedStatus: 'stopped' },
    { name: 'waiting', status: 'waiting', executionState: 'paused', expectedStatus: 'waiting' },
  ])('normalizes a superseded $name member to stopped', ({ status, executionState, expectedStatus }) => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    databaseManager.get().prepare('UPDATE sessions SET status=?, execution_state=? WHERE id=?')
      .run(status, executionState, worker.id);

    supersedeRunForCard(card.id, 'manual_move');

    expect(sessions.getById(worker.id)).toEqual(expect.objectContaining({
      status: expectedStatus,
      executionState: 'stopped',
      ownWorkState: 'cancelled',
    }));
  });

  describe('computeSubtreeOutcome (W5: pure FR-6 roll-up rule)', () => {
    it('is open when own work is still open, regardless of children', () => {
      expect(computeSubtreeOutcome('open', [])).toBe('open');
      expect(computeSubtreeOutcome('open', ['succeeded'])).toBe('open');
    });

    it('is open when own work succeeded but a child subtree is still open (FR-6.1 waiting-for-descendants)', () => {
      expect(computeSubtreeOutcome('closed_successfully', ['open'])).toBe('open');
      expect(computeSubtreeOutcome('closed_successfully', ['succeeded', 'open'])).toBe('open');
    });

    it('succeeds only when own work succeeded and every child subtree succeeded', () => {
      expect(computeSubtreeOutcome('closed_successfully', [])).toBe('succeeded');
      expect(computeSubtreeOutcome('closed_successfully', ['succeeded', 'succeeded'])).toBe('succeeded');
    });

    it('fails when own work failed, regardless of children', () => {
      expect(computeSubtreeOutcome('closed_failed', [])).toBe('failed');
      expect(computeSubtreeOutcome('closed_failed', ['succeeded'])).toBe('failed');
    });

    it('fails when any child subtree failed, even if own work succeeded', () => {
      expect(computeSubtreeOutcome('closed_successfully', ['succeeded', 'failed'])).toBe('failed');
    });

    it('is cancelled when own work was cancelled, unless a child failed (failed takes precedence)', () => {
      expect(computeSubtreeOutcome('cancelled', [])).toBe('cancelled');
      expect(computeSubtreeOutcome('cancelled', ['succeeded'])).toBe('cancelled');
      expect(computeSubtreeOutcome('closed_successfully', ['cancelled'])).toBe('cancelled');
      expect(computeSubtreeOutcome('cancelled', ['failed'])).toBe('failed');
    });
  });

  describe('structured subtree roll-up (W5: FR-6/FR-7, AC-3, AC-4)', () => {
    it('AC-3: root waits while an immediate child is open, then succeeds once the child succeeds', () => {
      const worker = sessions.create(project.id, 'Worker A', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);
      const b = sessions.create(project.id, 'Worker B', 'child work', { parentSessionId: worker.id });

      // A closes its own work before B finishes: A waits, card does not move.
      const aToken = beginWorkflowTurn(worker.id);
      expect(finalizeOwnWorkCompletion(worker.id, aToken).status).toBe('open');
      expect(sessions.getById(worker.id).ownWorkState).toBe('closed_successfully');
      expect(sessions.getById(worker.id).subtreeOutcome).toBe('open');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

      // B finishes: success rolls up to A, and the card moves.
      const bToken = beginWorkflowTurn(b.id);
      const reconciled = finalizeOwnWorkCompletion(b.id, bToken);
      expect(reconciled.status).toBe('succeeded');
      expect(sessions.getById(b.id).subtreeOutcome).toBe('succeeded');
      expect(sessions.getById(worker.id).subtreeOutcome).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    });

    it('AC-4: arbitrary depth — A creates B, B creates C; the card does not move until C, B, and A all succeed', () => {
      const a = sessions.create(project.id, 'A', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, a.id);
      const b = sessions.create(project.id, 'B', 'b work', { parentSessionId: a.id });
      const c = sessions.create(project.id, 'C', 'c work', { parentSessionId: b.id });
      expect(sessions.getById(b.id).laneRunId).toBe(run.id);
      expect(sessions.getById(c.id).laneRunId).toBe(run.id);

      const aToken = beginWorkflowTurn(a.id);
      finalizeOwnWorkCompletion(a.id, aToken);
      const bToken = beginWorkflowTurn(b.id);
      finalizeOwnWorkCompletion(b.id, bToken);

      // A and B have both closed their own work, but C is still open — nothing may move.
      expect(getRun(run.id).status).toBe('open');
      expect(sessions.getById(a.id).subtreeOutcome).toBe('open');
      expect(sessions.getById(b.id).subtreeOutcome).toBe('open');
      expect(sessions.getById(c.id).subtreeOutcome).toBe('open');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

      const cToken = beginWorkflowTurn(c.id);
      const reconciled = finalizeOwnWorkCompletion(c.id, cToken);

      expect(reconciled.status).toBe('succeeded');
      expect(sessions.getById(c.id).subtreeOutcome).toBe('succeeded');
      expect(sessions.getById(b.id).subtreeOutcome).toBe('succeeded');
      expect(sessions.getById(a.id).subtreeOutcome).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    });

    it('a grandchild failure fails the whole run even while the direct child is still open (deep failure propagation)', () => {
      const a = sessions.create(project.id, 'A', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, a.id);
      const b = sessions.create(project.id, 'B', 'b work', { parentSessionId: a.id });
      const c = sessions.create(project.id, 'C', 'c work', { parentSessionId: b.id });

      beginWorkflowTurn(c.id);
      const reconciled = closeOwnWork(c.id, 'closed_failed', 'C exploded');

      expect(reconciled.status).toBe('failed');
      expect(sessions.getById(c.id).subtreeOutcome).toBe('failed');
      // B's own work is still open (never finished), but its subtree is failed
      // because its blocking child C failed — B itself is not "closed_failed".
      expect(sessions.getById(b.id).ownWorkState).toBe('open');
      expect(sessions.getById(b.id).subtreeOutcome).toBe('failed');
      expect(sessions.getById(a.id).subtreeOutcome).toBe('failed');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
    });

    it('recomputeSubtreeOutcomes is idempotent and reconcilable from persisted rows alone (FR-6.4)', () => {
      const a = sessions.create(project.id, 'A', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, a.id);
      sessions.create(project.id, 'B', 'b work', { parentSessionId: a.id });

      expect(recomputeSubtreeOutcomes(run.id)).toBe('open');
      // Calling again with no state change must be a stable no-op.
      expect(recomputeSubtreeOutcomes(run.id)).toBe('open');
    });

    it('recomputeSubtreeOutcomes returns null for a run with no root session yet', () => {
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      expect(recomputeSubtreeOutcomes(run.id)).toBeNull();
    });
  });

  describe('idempotent lane-entry events + race hardening (W7: FR-1.5, AC-14)', () => {
    it('a duplicate completion-caused entry for the same source run resolves to the existing run instead of creating a second one', () => {
      const sourceRunId = 'source-run-fixed-id';

      const first = createLaneRunForEntry({
        projectId: project.id, workspaceId: root.id, cardId: card.id,
        lane: structuredLane(), cause: 'completion', priorLaneRunId: sourceRunId,
      });
      const second = createLaneRunForEntry({
        projectId: project.id, workspaceId: root.id, cardId: card.id,
        lane: structuredLane(), cause: 'completion', priorLaneRunId: sourceRunId,
      });

      expect(second.id).toBe(first.id);
      const allRuns = databaseManager.get().prepare('SELECT id FROM kanban_lane_runs WHERE prior_lane_run_id=?').all(sourceRunId);
      expect(allRuns).toHaveLength(1);
    });

    it('a second attempt to open a run for a card that already has one open resolves to the existing run (idx_lane_runs_one_open_card backstop)', () => {
      // No caused_by_run_id precheck applies to a plain 'card_added'/'manual_move'
      // cause, so this exercises the catch-path fallback: the INSERT itself hits
      // idx_lane_runs_one_open_card (at most one open run per card), and the
      // function resolves to the card's already-active run instead of throwing.
      const first = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      expect(getRun(first.id).status).toBe('open');

      const second = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });

      expect(second.id).toBe(first.id);
      const openRunsForCard = databaseManager.get()
        .prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'").all(card.id);
      expect(openRunsForCard).toHaveLength(1);
    });

    it('creates a detached child under a superseded lane run without changing the historical run', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);

      // Manual move revokes every open obligation in the run.
      supersedeRunForCard(card.id, 'manual_move');
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
      expect(getRun(run.id).status).toBe('superseded');
      const cardLaneId = kanbanCards.getById(card.id).laneId;

      const child = sessions.create(project.id, 'Late child', 'continue work', { parentSessionId: worker.id });

      expect(child.parentSessionId).toBe(worker.id);
      expect(child.laneRunId).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
      expect(kanbanCards.getById(card.id).laneId).toBe(cardLaneId);
    });

    it('creates a detached child after the parent closes and its run completes', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);

      finalizeOwnWorkCompletion(worker.id, beginWorkflowTurn(worker.id));
      expect(sessions.getById(worker.id).ownWorkState).toBe('closed_successfully');
      expect(getRun(run.id).status).toBe('succeeded');
      const cardLaneId = kanbanCards.getById(card.id).laneId;

      const child = sessions.create(project.id, 'Late child', 'continue work', { parentSessionId: worker.id });

      expect(child.parentSessionId).toBe(worker.id);
      expect(child.laneRunId).toBeNull();
      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(cardLaneId);
    });

    it('still allows children while the run is genuinely open', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);

      expect(() => sessions.create(project.id, 'Child', 'on time', { parentSessionId: worker.id })).not.toThrow();
    });
  });
});
