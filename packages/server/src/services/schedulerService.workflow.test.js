import { describe, expect, it, vi } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import { SchedulerService } from './schedulerService.js';
import { attachRootSession, beginWorkflowTurn, createLaneRunForEntry, finalizeOwnWorkCompletion, getRun } from './workflowSessionService.js';

describe('SchedulerService scheduled launch budget workflow lifecycle', () => {
  it('fails and reconciles an automated lane worker instead of stranding its open run', async () => {
    const project = projects.create('Budget lifecycle project', '/tmp/budget-lifecycle');
    const board = kanbanBoards.create(project.id);
    const [source, target] = kanbanLanes.getByBoardId(board.id);
    const workspace = sessions.create(project.id, 'Workspace', 'work');
    const card = kanbanCards.create(source.id, workspace.id);
    const worker = sessions.create(project.id, 'Automated worker', 'complete the lane', {
      parentSessionId: workspace.id,
    });
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...source, onEnterPrompt: 'complete the lane', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, worker.id);
    sessions.update(worker.id, {
      status: 'scheduled',
      scheduledAt: Date.now(),
      pendingPrompt: 'Continue',
      maxTotalTokens: 100,
    });
    sessions.updateUsage(worker.id, {
      inputTokens: 60,
      outputTokens: 40,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      contextWindow: 200000,
    });

    const scheduler = new SchedulerService();
    scheduler.initialize({ isSessionActive: () => false });
    const scheduledWorker = sessions.getById(worker.id);
    expect(scheduledWorker).toEqual(expect.objectContaining({
      maxTotalTokens: 100,
      inputTokens: 60,
      outputTokens: 40,
    }));

    await expect(scheduler.startScheduledSession(scheduledWorker)).resolves.toEqual({
      claimed: false,
      started: false,
      reason: 'launch_budget_exhausted',
      sessionId: worker.id,
    });

    expect(sessions.getById(worker.id)).toEqual(expect.objectContaining({
      status: 'stopped',
      scheduledAt: null,
      pendingPrompt: null,
      pendingConversationId: null,
      pendingModel: null,
      ownWorkState: 'closed_failed',
      executionState: 'stopped',
    }));
    expect(getRun(run.id)).toEqual(expect.objectContaining({
      status: 'failed',
      failedSessionId: worker.id,
    }));
    expect(kanbanCards.getById(card.id)).toEqual(expect.objectContaining({
      laneId: source.id,
      activeLaneRunId: run.id,
    }));
  });

  // Regression: a retired worker (lane run already succeeded) that was
  // auto-rescheduled — e.g. after a usage limit on a human follow-up turn —
  // must still launch its scheduled retry. Previously both the start claim and
  // the post-prompt-resolution fence rejected it as a stale worker, durably
  // clearing the schedule.
  it('launches a rescheduled retired worker instead of rejecting it as stale', async () => {
    const project = projects.create('Retired launch project', '/tmp/retired-launch');
    const board = kanbanBoards.create(project.id);
    const [source, target] = kanbanLanes.getByBoardId(board.id);
    const workspace = sessions.create(project.id, 'Workspace', 'work');
    const card = kanbanCards.create(source.id, workspace.id);
    const worker = sessions.create(project.id, 'Retired worker', 'complete the lane', {
      parentSessionId: workspace.id,
    });
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...source, onEnterPrompt: 'complete the lane', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, worker.id);
    // Discharge the obligation: run succeeds, worker retires but keeps its
    // historical lane_run_id pointer.
    finalizeOwnWorkCompletion(worker.id, beginWorkflowTurn(worker.id));
    expect(sessions.getById(worker.id).ownWorkState).toBe('closed_successfully');
    expect(getRun(run.id).status).toBe('succeeded');

    // The auto-reschedule after a usage limit on a follow-up turn.
    sessions.update(worker.id, {
      status: 'scheduled',
      scheduledAt: Date.now(),
      pendingPrompt: 'Continue',
    });

    const runSession = vi.fn().mockResolvedValue({ started: true, sessionId: worker.id });
    const scheduler = new SchedulerService();
    scheduler.initialize({ isSessionActive: () => false, runSession, continueSession: vi.fn() });

    const result = await scheduler.startScheduledSession(sessions.getById(worker.id));

    expect(result).toEqual(expect.objectContaining({
      claimed: true,
      started: true,
      sessionId: worker.id,
    }));
    expect(runSession).toHaveBeenCalledTimes(1);
    expect(runSession).toHaveBeenCalledWith(worker.id, expect.any(String), expect.any(String), expect.anything());

    // The durable clear happened and the board is untouched.
    expect(sessions.getById(worker.id)).toEqual(expect.objectContaining({
      scheduledAt: null,
      pendingPrompt: null,
      ownWorkState: 'closed_successfully',
    }));
    expect(getRun(run.id).status).toBe('succeeded');
  });
});
