import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseManager, kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, requestOwnWorkCompletion, attachRootSession, reconcileLaneRun,
  supersedeRunForCard, closeOwnWork, markExecutionState,
  computeSubtreeOutcome, recomputeSubtreeOutcomes,
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

  it('only advances after an explicit request for the current successful turn', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    expect(getRun(run.id).rootSessionId).toBe(worker.id);
    expect(sessions.getById(root.id).laneRunId).toBeNull();
    const token = beginWorkflowTurn(worker.id);
    expect(finalizeOwnWorkCompletion(worker.id, token)).toBeNull();
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

    expect(requestOwnWorkCompletion(worker.id, token, 'request-1')).toEqual({ accepted: true, idempotent: false });
    expect(finalizeOwnWorkCompletion(worker.id, token).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(getRun(run.id).openCount).toBe(0);
  });

  it('keeps scheduled work open even with a valid completion request', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);
    requestOwnWorkCompletion(worker.id, token, 'request-1');
    sessions.update(worker.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
    expect(finalizeOwnWorkCompletion(worker.id, token)).toBeNull();
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });

  it('inherits the run atomically for descendants and waits for them', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const child = sessions.create(project.id, 'Child', 'child work', { parentSessionId: worker.id });
    expect(sessions.getById(child.id).laneRunId).toBe(run.id);

    const rootToken = beginWorkflowTurn(worker.id);
    requestOwnWorkCompletion(worker.id, rootToken, 'root-request');
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
    requestOwnWorkCompletion(worker.id, token, 'request-1');

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

  it('documents that the dormant structured transition does not start target-lane work', () => {
    const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: structuredLane() });
    attachRootSession(run.id, worker.id);
    const token = beginWorkflowTurn(worker.id);
    requestOwnWorkCompletion(worker.id, token, 'request-1');

    expect(finalizeOwnWorkCompletion(worker.id, token).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    const sessionRows = databaseManager.get().prepare('SELECT id FROM sessions ORDER BY id').all();
    expect(sessionRows.map(({ id }) => id)).toEqual(expect.arrayContaining([root.id, worker.id]));
    expect(sessionRows).toHaveLength(2);
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
      requestOwnWorkCompletion(worker.id, aToken, 'a-request');
      expect(finalizeOwnWorkCompletion(worker.id, aToken).status).toBe('open');
      expect(sessions.getById(worker.id).ownWorkState).toBe('closed_successfully');
      expect(sessions.getById(worker.id).subtreeOutcome).toBe('open');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

      // B finishes: success rolls up to A, and the card moves.
      const bToken = beginWorkflowTurn(b.id);
      requestOwnWorkCompletion(b.id, bToken, 'b-request');
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
      requestOwnWorkCompletion(a.id, aToken, 'a-request');
      finalizeOwnWorkCompletion(a.id, aToken);
      const bToken = beginWorkflowTurn(b.id);
      requestOwnWorkCompletion(b.id, bToken, 'b-request');
      finalizeOwnWorkCompletion(b.id, bToken);

      // A and B have both closed their own work, but C is still open — nothing may move.
      expect(getRun(run.id).status).toBe('open');
      expect(sessions.getById(a.id).subtreeOutcome).toBe('open');
      expect(sessions.getById(b.id).subtreeOutcome).toBe('open');
      expect(sessions.getById(c.id).subtreeOutcome).toBe('open');
      expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

      const cToken = beginWorkflowTurn(c.id);
      requestOwnWorkCompletion(c.id, cToken, 'c-request');
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
});
