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
const { drainLaneEntryTriggerMock } = vi.hoisted(() => ({
  drainLaneEntryTriggerMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./kanbanService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    drainLaneEntryTrigger: drainLaneEntryTriggerMock,
  };
});

import { continueSession, runSession } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { KanbanBoardRepository } from '../db/KanbanBoardRepository.js';
import { KanbanLaneRepository } from '../db/KanbanLaneRepository.js';
import { KanbanCardRepository } from '../db/KanbanCardRepository.js';
import { createLaneRunForEntry, attachRootSession, getRun, markHeldForLimit, supersedeRunForCard } from './workflowSessionService.js';
import { moveCard } from './kanbanService.js';

describe('W6: _executeSession triggers target-lane automation after a real success', () => {
  let projectRepo;
  let sessionRepo;
  let messageRepo;
  let boardRepo;
  let laneRepo;
  let cardRepo;
  let tempDir;
  let project;
  let source;
  let target;
  let board;
  let workspace;
  let card;
  let root;
  let run;
  let createAgentSpy;

  beforeEach(() => {
    drainLaneEntryTriggerMock.mockClear();
    projectRepo = new ProjectRepository();
    sessionRepo = new SessionRepository();
    messageRepo = new MessageRepository();
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    cardRepo = new KanbanCardRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'w6-transition-test-'));

    project = projectRepo.create('W6 Project', tempDir);
    board = boardRepo.create(project.id);
    [source, target] = laneRepo.getByBoardId(board.id);
    target = laneRepo.update(target.id, { onEnterPrompt: 'perform target work' });
    workspace = sessionRepo.create(project.id, 'Workspace', 'work');
    card = cardRepo.create(source.id, workspace.id);
    root = sessionRepo.create(project.id, 'Lane prompt', 'do work', { parentSessionId: workspace.id });
    run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...laneRepo.getById(source.id), completionTargetLaneId: target.id },
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

    expect(drainLaneEntryTriggerMock).toHaveBeenCalledTimes(1);
    expect(drainLaneEntryTriggerMock).toHaveBeenCalledWith(expect.any(String));
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

    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
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
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });

  it('keeps own work open when a human sends a successful interactive follow-up', async () => {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'I can help with that.' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await continueSession(root.id, 'Can you clarify the approach?', tempDir, { interactive: true });

    expect(sessionRepo.getById(root.id).ownWorkState).toBe('open');
    expect(getRun(run.id).status).toBe('open');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });

  it('allows an interactive follow-up to complete a worker held for a provider limit', async () => {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'Work is complete.' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
    markHeldForLimit(root.id);

    await continueSession(root.id, 'Please resume and finish.', tempDir, { interactive: true });

    expect(sessionRepo.getById(root.id).ownWorkState).toBe('closed_successfully');
    expect(getRun(run.id).status).toBe('succeeded');
    expect(cardRepo.getById(card.id).laneId).toBe(target.id);
    expect(drainLaneEntryTriggerMock).toHaveBeenCalledTimes(1);
  });

  it('runs an interactive turn after its lane run has succeeded, but rejects a system turn', async () => {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'done' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await runSession(root.id, 'do work', tempDir);
    expect(getRun(run.id).status).toBe('succeeded');

    await continueSession(root.id, 'A human follow-up', tempDir, { interactive: true });
    expect(stubAgent.execute).toHaveBeenCalledTimes(2);

    await runSession(root.id, 'A stale system turn', tempDir);
    expect(stubAgent.execute).toHaveBeenCalledTimes(2);
  });

  it('does not call the provider when ownership is lost after admission but before execution', async () => {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    // runSession has already passed its initial ownership check by the time
    // it creates the provider adapter. Superseding here reproduces the final
    // race immediately before _executeSession's provider boundary.
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockImplementation(() => {
      supersedeRunForCard(card.id, 'test_race');
      return stubAgent;
    });

    const result = await runSession(root.id, 'do work', tempDir);

    expect(result).toEqual({ started: false, sessionId: root.id, reason: 'lane_run_ownership_lost' });
    expect(stubAgent.execute).not.toHaveBeenCalled();
    expect(getRun(run.id).status).toBe('superseded');
  });

  // Regression for incident b0fadc44: a lane-entry session that moves its own
  // workspace card mid-turn (as several lane prompts instruct) used to have
  // its own turn aborted ~10ms later as a side effect of the supersession
  // that move triggers, truncating its output. Supersession must revoke
  // workflow authority without touching the in-flight provider call.
  it('AC1/AC2: survives moving its own card mid-turn — output after the move is not lost', async () => {
    const nonStructuredLane = laneRepo.getByBoardId(board.id).find((lane) => lane.id !== source.id && lane.id !== target.id);
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'before move' }] } };
        // The agent moves its own workspace's card, exactly as the Review PR
        // and Testing/Validation lane prompts instruct on-enter workers to do.
        await moveCard(card.id, nonStructuredLane.id);
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'after move' }] } };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);

    await runSession(root.id, 'do work', tempDir);

    // The call was never aborted, so it only ran once and produced both
    // pieces of output — including everything emitted after the move.
    expect(stubAgent.execute).toHaveBeenCalledTimes(1);
    const texts = messageRepo.getBySessionId(root.id).map((m) => m.content);
    expect(texts).toEqual(expect.arrayContaining(['before move', 'after move']));

    // The session that issued the move lands as a normal successful
    // completion, not aborted/stopped/error.
    const finishedRoot = sessionRepo.getById(root.id);
    expect(finishedRoot.status).toBe('waiting');
    expect(finishedRoot.error).toBeFalsy();

    // The move itself succeeded and is the terminal state of the run the
    // mover belonged to: superseded, not failed or errored.
    expect(cardRepo.getById(card.id).laneId).toBe(nonStructuredLane.id);
    expect(getRun(run.id).status).toBe('superseded');

    // Because the target lane has no on-enter automation, no successor run
    // or lane-entry delivery was created or driven for this move.
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });
});
