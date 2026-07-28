import { beforeEach, describe, expect, it } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, requestOwnWorkCompletion, attachRootSession,
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
});
