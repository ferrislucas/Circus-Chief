import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseManager, kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, attachRootSession, reconcileLaneRun,
  supersedeRunForCard, closeOwnWork, markExecutionState,
  computeSubtreeOutcome, recomputeSubtreeOutcomes, attemptLaneRunTransition,
} from './workflowSessionService.js';

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
    return { ...kanbanLanes.getById(source.id), completionMode: 'structured', completionTargetLaneId: target.id };
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

  it('W6: the synchronous DB transition moves the card but hands off target-lane automation via pendingTargetLaneTrigger', () => {
    // finalizeOwnWorkCompletion/attemptLaneRunTransition stay synchronous and
    // free of any dependency on kanbanService.js (see the import-cycle note on
    // attemptLaneRunTransition) — starting the target lane's on-enter session
    // is necessarily async and is the caller's job (sessionExecution.js calls
    // kanbanService.triggerStructuredTransitionAutomation with this value).
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);

    const reconciled = finalizeOwnWorkCompletion(worker.id, token);

    expect(reconciled.status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(reconciled.pendingTargetLaneTrigger).toEqual({
      workspaceSessionId: root.id,
      targetLaneId: target.id,
      cardId: card.id,
      sourceRunId: run.id,
    });
    // No target-lane session exists yet — that only happens once the caller
    // acts on pendingTargetLaneTrigger.
    const sessionRows = databaseManager.get().prepare('SELECT id FROM sessions ORDER BY id').all();
    expect(sessionRows.map(({ id }) => id)).toEqual(expect.arrayContaining([root.id, worker.id]));
    expect(sessionRows).toHaveLength(2);
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

    it('rejects creating a blocking child under a superseded lane run (FR-3.6 late-child rejection)', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);

      // Manual move supersedes the run without touching worker.own_work_state.
      supersedeRunForCard(card.id, 'manual_move');
      expect(sessions.getById(worker.id).ownWorkState).toBe('open');
      expect(getRun(run.id).status).toBe('superseded');

      expect(() => sessions.create(project.id, 'Late child', 'too late', { parentSessionId: worker.id }))
        .toThrow('Cannot create a child under a terminal or superseded lane run');
    });

    it('still allows children while the run is genuinely open', () => {
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
      attachRootSession(run.id, worker.id);

      expect(() => sessions.create(project.id, 'Child', 'on time', { parentSessionId: worker.id })).not.toThrow();
    });
  });
});
