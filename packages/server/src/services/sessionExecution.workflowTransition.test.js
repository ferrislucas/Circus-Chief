import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// W6: kanbanService.js is mocked here so this test proves exactly one thing —
// that _executeSession (via runSession) calls
// kanbanService.triggerStructuredTransitionAutomation with the right
// descriptor when finalizeOwnWorkCompletion reports a pendingTargetLaneTrigger
// — without actually spawning the target lane's on-enter session (that full
// chain, including "starts exactly once", is covered directly and safely in
// kanbanService.test.js without any fire-and-forget async session execution
// racing this test's teardown).
const { triggerStructuredTransitionAutomationMock } = vi.hoisted(() => ({
  triggerStructuredTransitionAutomationMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./kanbanService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    triggerStructuredTransitionAutomation: triggerStructuredTransitionAutomationMock,
  };
});

import { runSession } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { KanbanBoardRepository } from '../db/KanbanBoardRepository.js';
import { KanbanLaneRepository } from '../db/KanbanLaneRepository.js';
import { KanbanCardRepository } from '../db/KanbanCardRepository.js';
import { createLaneRunForEntry, attachRootSession, getRun } from './workflowSessionService.js';

describe('W6: _executeSession triggers target-lane automation after a real success', () => {
  let projectRepo;
  let sessionRepo;
  let boardRepo;
  let laneRepo;
  let cardRepo;
  let tempDir;
  let project;
  let source;
  let target;
  let workspace;
  let card;
  let root;
  let run;
  let createAgentSpy;

  beforeEach(() => {
    triggerStructuredTransitionAutomationMock.mockClear();
    projectRepo = new ProjectRepository();
    sessionRepo = new SessionRepository();
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    cardRepo = new KanbanCardRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'w6-transition-test-'));

    project = projectRepo.create('W6 Project', tempDir);
    const board = boardRepo.create(project.id);
    [source, target] = laneRepo.getByBoardId(board.id);
    workspace = sessionRepo.create(project.id, 'Workspace', 'work');
    card = cardRepo.create(source.id, workspace.id);
    root = sessionRepo.create(project.id, 'Lane prompt', 'do work', { parentSessionId: workspace.id });
    run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...laneRepo.getById(source.id), completionMode: 'structured', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, root.id);
  });

  afterEach(() => {
    createAgentSpy?.mockRestore();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('calls triggerStructuredTransitionAutomation exactly once with the pending descriptor (AC-2, target on-entry starts exactly once)', async () => {
    const stubAgent = {
      execute: vi.fn(async function* (_queryParams, _agentCallMeta) {
        yield { type: 'assistant', text: 'done' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await runSession(root.id, 'do work', tempDir);

    expect(triggerStructuredTransitionAutomationMock).toHaveBeenCalledTimes(1);
    expect(triggerStructuredTransitionAutomationMock).toHaveBeenCalledWith({
      workspaceSessionId: workspace.id,
      targetLaneId: target.id,
      cardId: card.id,
      sourceRunId: run.id,
    });
    expect(cardRepo.getById(card.id).laneId).toBe(target.id);
  });

  it('keeps the run open when the successful turn self-schedules more work', async () => {
    const stubAgent = {
      execute: vi.fn(async function* (_queryParams, agentCallMeta) {
        sessionRepo.update(agentCallMeta.sessionId, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
        yield { type: 'assistant', text: 'still working' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await runSession(root.id, 'do work', tempDir);

    expect(triggerStructuredTransitionAutomationMock).not.toHaveBeenCalled();
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
  });

  it('does not advance the card when the turn ends gracefully on a provider usage limit', async () => {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: "You've reached your usage limit" };
        yield { type: 'result', success: true, result: "You've reached your usage limit" };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await runSession(root.id, 'do work', tempDir);

    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
    expect(getRun(run.id)).toEqual(expect.objectContaining({
      status: 'open',
      rootOwnWorkState: 'open',
      pausedCount: 1,
      blockingReason: 'Paused — provider limit or outage',
    }));
    expect(triggerStructuredTransitionAutomationMock).not.toHaveBeenCalled();
  });
});
