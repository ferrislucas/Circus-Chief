import { describe, expect, it } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions } from '../database.js';
import { SchedulerService } from './schedulerService.js';
import { attachRootSession, createLaneRunForEntry, getRun } from './workflowSessionService.js';

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
});
