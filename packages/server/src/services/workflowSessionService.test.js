import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseManager, kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, requestOwnWorkCompletion, attachRootSession, reconcileLaneRun,
  supersedeRunForCard,
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

  it.todo('wires execution failures and cancellations into closed_failed/cancelled before structured lanes are enabled');

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
});
