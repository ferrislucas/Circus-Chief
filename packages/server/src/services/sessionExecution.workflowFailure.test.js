import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runSession, continueSession } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { KanbanBoardRepository } from '../db/KanbanBoardRepository.js';
import { KanbanLaneRepository } from '../db/KanbanLaneRepository.js';
import { KanbanCardRepository } from '../db/KanbanCardRepository.js';
import { createLaneRunForEntry, attachRootSession, getRun } from './workflowSessionService.js';

/**
 * W4 (FRD: Kanban Lane-Run Structured Completion, FR-9, AC-7/AC-8): proves
 * that a real execution failure/reschedule through _executeSession (reached
 * via the public runSession() entry point, exactly as production code calls
 * it) actually closes or keeps open a participating session's own-work
 * obligation — not just the workflowSessionService unit-level state machine.
 *
 * Before this change, nothing in the execution path ever set own_work_state
 * to closed_failed, so reconcileLaneRun's failure branch was dead code and a
 * permanently failing blocking session could never fail its lane run.
 */
describe('W4: failure/cancellation propagation through _executeSession', () => {
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
    projectRepo = new ProjectRepository();
    sessionRepo = new SessionRepository();
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    cardRepo = new KanbanCardRepository();
    tempDir = mkdtempSync(join(tmpdir(), 'w4-fail-test-'));

    project = projectRepo.create('W4 Project', tempDir);
    const board = boardRepo.create(project.id);
    [source, target] = laneRepo.getByBoardId(board.id);
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

  function stubThrowingAgent(message) {
    const stubAgent = {
      // Deliberately throws before ever yielding, to simulate a real agent execution failure.
      // eslint-disable-next-line require-yield
      execute: vi.fn(async function* () {
        throw new Error(message);
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
    return stubAgent;
  }

  function stubResultErrorAgent(message) {
    const stubAgent = {
      // Codex reports some terminal failures as a final stream event and then
      // closes the generator normally instead of rejecting execute().
      execute: vi.fn(async function* () {
        yield { type: 'result', subtype: 'error', is_error: true, error: message };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
    return stubAgent;
  }

  function stubSuccessAgent() {
    const stubAgent = {
      execute: vi.fn(async function* () {
        yield { type: 'assistant', text: 'done' };
        yield { type: 'result', success: true };
      }),
      supportsResume: () => false,
      needsConversationContext: () => true,
    };
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
    return stubAgent;
  }

  it('a permanent execution failure fails the run and does not move the card (AC-8)', async () => {
    stubThrowingAgent('boom: permanent failure');

    await expect(runSession(root.id, 'do work', tempDir)).rejects.toThrow('boom: permanent failure');

    const updated = sessionRepo.getById(root.id);
    expect(updated.ownWorkState).toBe('closed_failed');
    expect(updated.workflowReason).toBe('boom: permanent failure');
    expect(updated.executionState).toBe('stopped');
    expect(getRun(run.id).status).toBe('failed');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
  });

  it('a transient service error with an automatic retry keeps the run open (AC-7)', async () => {
    sessionRepo.update(root.id, { autoRescheduleEnabled: true, rescheduleOnServiceError: true });
    stubThrowingAgent('503 Service Unavailable');

    // Rescheduled — must NOT reject.
    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.ownWorkState).toBe('open');
    expect(updated.executionState).toBe('retrying');
    expect(getRun(run.id).status).toBe('open');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
  });

  it('a terminal result event for a token limit is automatically rescheduled and keeps the run open', async () => {
    sessionRepo.update(root.id, {
      autoRescheduleEnabled: true,
      rescheduleOnTokenLimit: true,
      rescheduleDelayMinutes: 15,
    });
    stubResultErrorAgent("You've hit your usage limit. Try again later.");

    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.ownWorkState).toBe('open');
    expect(updated.status).toBe('scheduled');
    expect(updated.scheduledAt).toEqual(expect.any(Number));
    expect(updated.rescheduleCount).toBe(1);
    expect(updated.executionState).toBe('retrying');
    expect(getRun(run.id).status).toBe('open');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
  });

  // Regression for a production incident: a worker whose lane run had already
  // succeeded received a human follow-up that hit the provider usage limit.
  // The error matched the reschedule triggers, but the reschedule write was
  // fenced off by the session's historical lane_run_id pointer and silently
  // dropped — the session was left in 'error' with no retry.
  it('a usage limit on a follow-up turn of a retired (succeeded run) worker is still rescheduled', async () => {
    sessionRepo.update(root.id, {
      autoRescheduleEnabled: true,
      rescheduleOnTokenLimit: true,
      rescheduleDelayMinutes: 15,
    });

    // Turn 1 succeeds: own work closes, run succeeds, card moves to target.
    stubSuccessAgent();
    await runSession(root.id, 'do work', tempDir);
    expect(sessionRepo.getById(root.id).ownWorkState).toBe('closed_successfully');
    expect(getRun(run.id).status).toBe('succeeded');
    const targetLaneId = cardRepo.getById(card.id).laneId;
    expect(targetLaneId).toBe(target.id);

    // Turn 2: a human follow-up (interactive) hits the usage limit.
    stubResultErrorAgent("You've hit your usage limit. Try again later.");
    await continueSession(root.id, 'A human follow-up', tempDir, { interactive: true });

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('scheduled');
    expect(updated.scheduledAt).toEqual(expect.any(Number));
    expect(updated.rescheduleCount).toBe(1);
    expect(updated.pendingPrompt).toEqual(expect.any(String));
    expect(updated.pendingPrompt.trim().length).toBeGreaterThan(0);

    // The board is untouched by the follow-up and its reschedule: the
    // obligation was already discharged; the retry is ordinary session work.
    expect(updated.ownWorkState).toBe('closed_successfully');
    expect(getRun(run.id).status).toBe('succeeded');
    expect(cardRepo.getById(card.id).laneId).toBe(targetLaneId);
  });

  it('a non-retryable terminal result event fails rather than successfully completing the run', async () => {
    stubResultErrorAgent('boom: permanent result failure');

    await runSession(root.id, 'do work', tempDir);

    const updated = sessionRepo.getById(root.id);
    expect(updated.status).toBe('error');
    expect(updated.ownWorkState).toBe('closed_failed');
    expect(updated.workflowReason).toBe('boom: permanent result failure');
    expect(updated.executionState).toBe('stopped');
    expect(getRun(run.id).status).toBe('failed');
    expect(cardRepo.getById(card.id).laneId).toBe(source.id);
  });
});
