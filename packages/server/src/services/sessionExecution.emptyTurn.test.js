import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// The success-path tests below move the card, which would otherwise drive
// real target-lane delivery. Mock only the async drain boundary (same pattern
// as sessionExecution.workflowTransition.test.js) so assertions stay on the
// empty-turn decision itself.
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

import { runSession } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { KanbanBoardRepository } from '../db/KanbanBoardRepository.js';
import { KanbanLaneRepository } from '../db/KanbanLaneRepository.js';
import { KanbanCardRepository } from '../db/KanbanCardRepository.js';
import {
  createLaneRunForEntry,
  attachRootSession,
  getRun,
  supersedeRunForCard,
} from './workflowSessionService.js';
import { activeSessions } from './streamEventHandler.js';
import { isSubstantiveTurnEvent } from './turnGuard.js';
import { triggerOnEnterPrompt, reconcileUndeliveredChild } from './kanbanTriggers.js';

/**
 * False-success + stuck-session lifecycle regressions.
 *
 * Incident: an automated lane-run turn terminated at the protocol level with
 * no assistant message/output and no verifiable continuation artifact, yet the
 * lane run was marked succeeded and the card moved to Done — while a child
 * session was left parked in status=starting / executionState=idle with no
 * active process and no prompt controls.
 */
describe('empty automated turns and stuck starting sessions', () => {
  let projectRepo;
  let sessionRepo;
  let messageRepo;
  let boardRepo;
  let laneRepo;
  let cardRepo;
  let tempDir;
  let project;
  let board;
  let source;
  let target;
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
    tempDir = mkdtempSync(join(tmpdir(), 'empty-turn-test-'));

    project = projectRepo.create('Empty Turn Project', tempDir);
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

  function stubAgent(events) {
    const stub = {
      execute: vi.fn(async function* () {
        yield* events;
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stub);
    return stub;
  }

  describe('isSubstantiveTurnEvent', () => {
    it.each([
      [{ type: 'assistant', text: 'done' }, true],
      [{ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }, true],
      [{ type: 'tool_result', content: 'ok', tool_name: 'Bash' }, true],
      [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }, true],
      [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } }, true],
      [{ type: 'result', success: true, result: 'did the thing' }, true],
      [{ type: 'result', subtype: 'success', total_cost_usd: 0.01 }, true],
      [{ type: 'result', subtype: 'success', usage: { input_tokens: 5 } }, true],
      [{ type: 'system', subtype: 'init' }, false],
      [{ type: 'stream_event', event: { type: 'message_start' } }, false],
      [{ type: 'stream_event', event: { type: 'message_delta' } }, false],
      [{ type: 'result', success: true }, false],
      [{ type: 'result', subtype: 'success' }, false],
      [{ type: 'result', subtype: 'success', result: '   ' }, false],
      [{}, false],
      [null, false],
    ])('classifies %j as substantive=%s', (event, expected) => {
      expect(isSubstantiveTurnEvent(event)).toBe(expected);
    });
  });

  it('fails the lane run (not success) when the provider stream yields nothing', async () => {
    const emptyStub = {
      // eslint-disable-next-line require-yield
      execute: vi.fn(async function* () {}),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(emptyStub);

    // An empty turn resolves (like terminal result errors) rather than throwing.
    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toMatch(/no assistant output/);
    expect(updated.ownWorkState).toBe('closed_failed');
    expect(updated.executionState).toBe('stopped');
    // The provider produced no output; the only assistant message is the
    // surfaced failure itself, which keeps the session diagnosable.
    const assistantMessages = messageRepo.getBySessionId(root.id).filter((m) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    expect(assistantMessages.every((m) => m.content.includes('no assistant output'))).toBe(true);
    expect(getRun(run.id).status).toBe('failed');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });

  it('fails the lane run when the stream closes with only a bare success result', async () => {
    stubAgent([{ type: 'result', success: true }]);

    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('error');
    expect(updated.ownWorkState).toBe('closed_failed');
    expect(getRun(run.id).status).toBe('failed');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });

  it('still succeeds a tool-only turn with no assistant text', async () => {
    stubAgent([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'tool_result', content: 'file.txt', tool_name: 'Bash' },
      { type: 'result', subtype: 'success' },
    ]);

    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('waiting');
    expect(updated.ownWorkState).toBe('closed_successfully');
    expect(getRun(run.id).status).toBe('succeeded');
    expect(cardRepo.getById(card.id).laneId).toBe(target.id);
    expect(drainLaneEntryTriggerMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the run open when an otherwise-empty turn self-schedules a continuation', async () => {
    const stub = {
      // eslint-disable-next-line require-yield -- empty stream is the case under test
      execute: vi.fn(async function* (_queryParams, agentCallMeta) {
        sessionRepo.update(agentCallMeta.sessionId, { scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' });
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stub);

    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('scheduled');
    expect(updated.ownWorkState).toBe('open');
    expect(getRun(run.id).status).toBe('open');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
    expect(drainLaneEntryTriggerMock).not.toHaveBeenCalled();
  });

  it('reconciles a rejected dispatch out of starting so it stays recoverable', async () => {
    expect(sessionRepo.getById(root.id).status).toBe('starting');

    supersedeRunForCard(card.id, 'test_race');
    const result = await runSession(root.id, 'do work', tempDir);

    expect(result).toEqual({ started: false, sessionId: root.id, reason: 'lane_run_ownership_lost' });
    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('stopped');
    expect(updated.executionState).toBe('stopped');
    expect(getRun(run.id).status).toBe('superseded');
  });

  describe('reconcileUndeliveredChild', () => {
    let child;

    beforeEach(() => {
      child = sessionRepo.create(project.id, 'Lane child', 'prompt', { parentSessionId: workspace.id });
      expect(sessionRepo.getById(child.id).status).toBe('starting');
    });

    it('moves an idle starting child to stopped', () => {
      expect(reconcileUndeliveredChild(child.id)).toBe(true);
      const updated = sessionRepo.getById(child.id);
      expect(updated.status).toBe('stopped');
      expect(updated.executionState).toBe('stopped');
    });

    it('leaves children that already left starting alone', () => {
      sessionRepo.update(child.id, { status: 'running' });
      expect(reconcileUndeliveredChild(child.id)).toBe(false);
      expect(sessionRepo.getById(child.id).status).toBe('running');
    });

    it('leaves a child with a live turn alone', () => {
      const controller = new AbortController();
      activeSessions.set(child.id, { controller, turnStartedAt: Date.now(), lastEventAt: Date.now() });
      try {
        expect(reconcileUndeliveredChild(child.id)).toBe(false);
        expect(sessionRepo.getById(child.id).status).toBe('starting');
      } finally {
        activeSessions.delete(child.id);
      }
    });
  });

  it('reconciles the lane-entry child when delivery fails after creation', async () => {
    const lane = { ...laneRepo.getById(source.id), onEnterPrompt: 'review the diff' };

    const result = await triggerOnEnterPrompt(workspace.id, lane, {
      beforeDispatch: () => { throw new Error('claim lost'); },
    });

    expect(result.delivered).toBe(false);
    const descendants = sessionRepo.getAllDescendantIds(workspace.id);
    expect(descendants).toHaveLength(2); // pre-existing root + new lane child
    const childId = descendants.find((id) => id !== root.id);
    const child = sessionRepo.getById(childId);
    expect(child.status).toBe('stopped');
    expect(child.executionState).toBe('stopped');
  });

  it('does not orphan a starting child when root attach fails', async () => {
    // The run already has a different root, so the new child's attach throws
    // after its row was created. The orphan must still land recoverable.
    const lane = { ...laneRepo.getById(source.id), onEnterPrompt: 'review the diff' };

    const result = await triggerOnEnterPrompt(workspace.id, lane, { laneRunId: run.id });

    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/different root session/);
    const descendants = sessionRepo.getAllDescendantIds(workspace.id);
    expect(descendants).toHaveLength(2); // pre-existing root + orphaned child
    const childId = descendants.find((id) => id !== root.id);
    const child = sessionRepo.getById(childId);
    expect(child.status).toBe('stopped');
    expect(child.executionState).toBe('stopped');
  });
});
