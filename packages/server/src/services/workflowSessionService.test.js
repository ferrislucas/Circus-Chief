import { beforeEach, describe, expect, it } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import {
  beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion,
  getRun, requestOwnWorkCompletion,
} from './workflowSessionService.js';

describe('workflowSessionService', () => {
  let project; let board; let source; let target; let root; let card;

  beforeEach(() => {
    project = projects.create('Workflow project', '/tmp/workflow');
    board = kanbanBoards.create(project.id);
    [source, target] = kanbanLanes.getByBoardId(board.id);
    kanbanLanes.update(source.id, { completionMode: 'structured', completionTargetLaneId: target.id });
    root = sessions.create(project.id, 'Root', 'work');
    card = kanbanCards.create(source.id, root.id);
  });

  it('only advances after an explicit request for the current successful turn', () => {
    const run = createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(source.id) });
    const token = beginWorkflowTurn(root.id);
    expect(finalizeOwnWorkCompletion(root.id, token)).toBeNull();
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);

    expect(requestOwnWorkCompletion(root.id, token, 'request-1')).toEqual({ accepted: true, idempotent: false });
    expect(finalizeOwnWorkCompletion(root.id, token).status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
    expect(getRun(run.id).openCount).toBe(0);
  });

  it('keeps scheduled work open even with a valid completion request', () => {
    createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(source.id) });
    const token = beginWorkflowTurn(root.id);
    requestOwnWorkCompletion(root.id, token, 'request-1');
    sessions.update(root.id, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
    expect(finalizeOwnWorkCompletion(root.id, token)).toBeNull();
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });

  it('inherits the run atomically for descendants and waits for them', () => {
    createLaneRunForEntry({ projectId: project.id, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(source.id) });
    const child = sessions.create(project.id, 'Child', 'child work', { parentSessionId: root.id });
    expect(sessions.getById(child.id).laneRunId).toBe(sessions.getById(root.id).laneRunId);

    const rootToken = beginWorkflowTurn(root.id);
    requestOwnWorkCompletion(root.id, rootToken, 'root-request');
    expect(finalizeOwnWorkCompletion(root.id, rootToken).status).toBe('open');
    expect(kanbanCards.getById(card.id).laneId).toBe(source.id);
  });
});
