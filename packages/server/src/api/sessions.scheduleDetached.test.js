import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from './sessions.js';
import {
  projects, sessions, modelProviders, conversations,
  kanbanBoards, kanbanCards, kanbanLanes,
} from '../database.js';
import { activeSessions } from '../services/sessionExecutionOwnership.js';
import { handleTurnCompletion } from '../services/streamEventHandler.js';
import { SchedulerService } from '../services/schedulerService.js';
import {
  attachRootSession,
  createLaneRunForEntry,
  getRun,
  supersedeRunForCard,
  supersedeLaneRunAuthorityOnly,
  activeLaneRunOwnsSession,
  beginWorkflowTurn,
  claimWorkflowSessionStart,
  withActiveLaneRunOwnership,
} from '../services/workflowSessionService.js';
import { reconcileKanbanOwnership } from '../services/kanbanRecoveryService.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service (needed by sessions-patch.js)
vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
  propagatePrUrlToParent: vi.fn(),
}));

vi.mock('../services/diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue({ staged: null, unstaged: null, untracked: null }),
  getChangesBranch: vi.fn(),
}));

vi.mock('../services/gitService.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
}));

// Mock prStatusService (needed by sessions-patch.js)
vi.mock('../services/prStatusService.js', () => ({
  checkSessionCiStatusNow: vi.fn().mockResolvedValue(false),
}));

// Mock summaryBroadcast (needed by sessions-patch.js)
vi.mock('../services/summaryBroadcast.js', async (importOriginal) => ({
  ...await importOriginal(),
  broadcastSummaryUpdate: vi.fn(),
}));

describe('Sessions API - POST /:id/schedule for detached workers', () => {
  let app;
  let project;
  let openaiProvider;

  const completionStubs = () => ({
    checkProactiveReschedule: vi.fn().mockResolvedValue(false),
    handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
    handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    activeSessions.clear();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Detached Schedule Project', '/tmp/test-detached');
    openaiProvider = null;
  });

  afterEach(() => {
    activeSessions.clear();
    if (openaiProvider) {
      try {
        modelProviders.delete(openaiProvider.id);
      } catch {
        // Test cleanup only.
      }
    }
  });

  function attachLaneWorker() {
    const board = kanbanBoards.create(project.id);
    const [source, target] = kanbanLanes.getByBoardId(board.id);
    const workspace = sessions.create(project.id, 'Workspace', 'work');
    const worker = sessions.create(project.id, 'Lane worker', 'work', { parentSessionId: workspace.id });
    const card = kanbanCards.create(source.id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...source, onEnterPrompt: 'Perform lane work', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, worker.id);
    return { board, card, run, worker, workspace };
  }

  function startProviderTurn(worker) {
    sessions.update(worker.id, { status: 'running' });
    activeSessions.set(worker.id, { controller: { signal: { aborted: false } } });
  }

  // ── RED-1 control (passes today): attached worker self-schedules ──

  it('RED-1 control: attached worker with active lane-run ownership self-schedules mid-turn', async () => {
    const { worker } = attachLaneWorker();
    startProviderTurn(worker);
    expect(activeLaneRunOwnsSession(worker.id)).toBe(true);

    const scheduledAt = Date.now() + 3600000;
    const response = await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt: 'Continue lane work', scheduledAt })
      .expect(200);

    expect(response.body.pendingInteractive).toBe(false);
    expect(sessions.getById(worker.id).pendingPrompt).toBe('Continue lane work');
  });

  // ── RED-2: detached set-but-superseded schedules as independent continuation ──

  it('RED-2: superseded worker schedules an independent continuation on the same session', async () => {
    const { board, card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    // Detached but not deleted: ownership is gone, the session row survives.
    expect(activeLaneRunOwnsSession(worker.id)).toBe(false);
    const sessionCountBefore = sessions.getCountByProjectId(project.id);
    const cardCountBefore = kanbanCards.getByBoardId(board.id).length;

    await request(app)
      .get(`/api/sessions/${worker.id}`)
      .expect(200);

    const scheduledAt = Date.now() + 3600000;
    const prompt = 'Continue: poll the existing durable verification job; do not start a duplicate.';
    const response = await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    expect(response.body.id).toBe(worker.id);
    expect(response.body.pendingPrompt).toBe(prompt);
    expect(response.body.scheduledAt).toBe(scheduledAt);

    const stored = sessions.getById(worker.id);
    expect(stored.pendingPrompt).toBe(prompt);
    expect(stored.scheduledAt).toBe(scheduledAt);

    // Board-inert: no new workspace/session/card as a side effect.
    expect(sessions.getCountByProjectId(project.id)).toBe(sessionCountBefore);
    expect(kanbanCards.getByBoardId(board.id).length).toBe(cardCountBefore);
    expect(kanbanCards.getById(card.id)).toBeTruthy();
  });

  // ── RED-3: detached released (lane_run_id NULL) ──

  it('RED-3: released worker (lane_run_id NULL) schedules an independent continuation', async () => {
    const { card, run, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeLaneRunAuthorityOnly(run.id, 'manual_move');
    void card;

    const released = sessions.getById(worker.id);
    expect(released.laneRunId).toBeNull();

    const scheduledAt = Date.now() + 3600000;
    const response = await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt: 'Poll the existing job; do not start a duplicate.', scheduledAt })
      .expect(200);

    expect(response.body.id).toBe(worker.id);
    expect(sessions.getById(worker.id).pendingPrompt).toBe('Poll the existing job; do not start a duplicate.');
  });

  // ── RED-4: user-authority marking ──

  it('RED-4: detached self-schedule is marked pendingInteractive (user authority)', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    const response = await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt: 'Wake me up to check my own job', scheduledAt: Date.now() + 3600000 })
      .expect(200);

    expect(response.body.pendingInteractive).toBe(true);
    expect(sessions.getById(worker.id).pendingInteractive).toBe(true);
  });

  // ── RED-5: turn survival ──

  it('RED-5: completing the turn re-applies the detached schedule instead of erasing it', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    const scheduledAt = Date.now() + 3600000;
    const prompt = 'Poll the existing job after this turn';
    await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    await handleTurnCompletion(worker.id, '/tmp/test-detached', completionStubs());

    const stored = sessions.getById(worker.id);
    expect(stored.status).toBe('scheduled');
    expect(stored.scheduledAt).toBe(scheduledAt);
    expect(stored.pendingPrompt).toBe(prompt);
    expect(stored.pendingInteractive).toBe(true);
  });

  // ── RED-6: launchable exactly once ──

  it('RED-6: due detached continuation launches exactly once and is not reaped as stale', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    const scheduledAt = Date.now() + 3600000;
    await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt: 'Poll the existing job; do not start a duplicate.', scheduledAt })
      .expect(200);

    // Turn ends; the schedule is re-applied and becomes due. The controller
    // must still be registered during completion (as in a real turn teardown)
    // or the completion path takes the inactive shortcut and never re-applies.
    await handleTurnCompletion(worker.id, '/tmp/test-detached', completionStubs());
    activeSessions.delete(worker.id);
    sessions.update(worker.id, { scheduledAt: Date.now() - 1000 });
    conversations.create(worker.id, 'Detached continuation conversation');

    // Launch-time guard treats the user-authorized continuation as ownable work.
    expect(claimWorkflowSessionStart(worker.id)).toBe(true);

    const scheduler = new SchedulerService();
    const runSession = vi.fn().mockResolvedValue({ started: true, sessionId: worker.id });
    scheduler.initialize({ isSessionActive: () => false, runSession });

    const first = await scheduler.startScheduledSession(sessions.getById(worker.id));
    expect(first).toMatchObject({ claimed: true, started: true });

    // A racing second claim loses instead of starting a duplicate job.
    const second = await scheduler.startScheduledSession(sessions.getById(worker.id));
    expect(second.claimed).toBe(false);
    expect(runSession).toHaveBeenCalledTimes(1);
  });

  // ── RED-7: lane fences intact ──

  it('RED-7a: detached lane-directed (non-interactive) work is still reaped at launch', () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    // Seed lane-directed pending work the way the old system path did.
    sessions.update(worker.id, {
      status: 'scheduled',
      scheduledAt: Date.now() + 3600000,
      pendingPrompt: 'Continue lane work',
      pendingInteractive: false,
    });

    expect(claimWorkflowSessionStart(worker.id)).toBe(false);
    const reaped = sessions.getById(worker.id);
    expect(reaped.pendingPrompt).toBeNull();
    expect(reaped.scheduledAt).toBeNull();
  });

  it('RED-7b: detached worker cannot begin a lane turn or write through the ownership gate', () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    expect(beginWorkflowTurn(worker.id)).toBeNull();
    expect(withActiveLaneRunOwnership(worker.id, () => sessions.update(worker.id, { status: 'running' }))).toBeNull();
  });

  // ── RED-8 (#1): detached interactive schedule survives startup reconciliation ──

  it('RED-8: detached interactive schedule survives reconcileKanbanOwnership', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    const scheduledAt = Date.now() + 3600000;
    const prompt = 'Poll the existing job after restart; do not start a duplicate.';
    await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    const before = sessions.getById(worker.id);
    expect(before.pendingInteractive).toBe(true);

    reconcileKanbanOwnership({ dryRun: false });

    const after = sessions.getById(worker.id);
    expect(after.scheduledAt).toBe(scheduledAt);
    expect(after.pendingPrompt).toBe(prompt);
    expect(after.pendingInteractive).toBe(true);
  });

  it('RED-8b: reconciliation still clears detached non-interactive schedules', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    // Leftover lane-directed row (never writable via the endpoint today).
    sessions.update(worker.id, {
      status: 'scheduled',
      scheduledAt: Date.now() + 3600000,
      pendingPrompt: 'Leftover lane work',
      pendingInteractive: false,
    });

    reconcileKanbanOwnership({ dryRun: false });

    const reaped = sessions.getById(worker.id);
    expect(reaped.pendingPrompt).toBeNull();
    expect(reaped.scheduledAt).toBeNull();
  });

  // ── RED-9 (#4): hostile prompt through the endpoint cannot drive the board ──

  it('RED-9: revive-flavored prompt through the endpoint launches only as interactive work', async () => {
    const { board, card, run, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    // The endpoint cannot distinguish "revive the lane" from "poll my job":
    // a lane-hostile prompt posted through the real path must still succeed
    // as a lane-inert continuation.
    const prompt = 'Revive the superseded worker and resume the lane run';
    const response = await request(app)
      .post(`/api/sessions/${worker.id}/schedule`)
      .send({ prompt, scheduledAt: Date.now() + 3600000 })
      .expect(200);
    expect(response.body.pendingInteractive).toBe(true);

    // Lane fences: the detached session can never begin lane work.
    expect(beginWorkflowTurn(worker.id)).toBeNull();

    // Snapshot board state before turn completion + scheduler launch.
    const cardBefore = JSON.stringify(kanbanCards.getById(card.id));
    const runBefore = JSON.stringify(getRun(run.id));
    const sessionCountBefore = sessions.getCountByProjectId(project.id);
    const cardCountBefore = kanbanCards.getByBoardId(board.id).length;

    // Turn ends; the schedule is re-applied and becomes due.
    await handleTurnCompletion(worker.id, '/tmp/test-detached', completionStubs());
    activeSessions.delete(worker.id);
    sessions.update(worker.id, { scheduledAt: Date.now() - 1000 });
    conversations.create(worker.id, 'Detached continuation conversation');

    // The continuation is launchable, but only as interactive user work — and
    // it is the hostile prompt itself that launches, not a sanitized substitute.
    expect(sessions.getById(worker.id).pendingPrompt).toBe(prompt);
    expect(sessions.getById(worker.id).pendingInteractive).toBe(true);
    expect(claimWorkflowSessionStart(worker.id)).toBe(true);

    const scheduler = new SchedulerService();
    const runSession = vi.fn().mockResolvedValue({ started: true, sessionId: worker.id });
    scheduler.initialize({ isSessionActive: () => false, runSession });
    const launched = await scheduler.startScheduledSession(sessions.getById(worker.id));
    expect(launched).toMatchObject({ claimed: true, started: true });

    // Board-inert: no run claim, no lane transition, no card move.
    expect(beginWorkflowTurn(worker.id)).toBeNull();
    expect(JSON.stringify(kanbanCards.getById(card.id))).toBe(cardBefore);
    expect(JSON.stringify(getRun(run.id))).toBe(runBefore);
    expect(sessions.getCountByProjectId(project.id)).toBe(sessionCountBefore);
    expect(kanbanCards.getByBoardId(board.id).length).toBe(cardCountBefore);
  });

  it('RED-7c: turn completion refuses to restore scheduled status for leftover non-interactive rows', async () => {
    const { card, worker } = attachLaneWorker();
    startProviderTurn(worker);
    supersedeRunForCard(card.id, 'test_supersession');

    // A leftover lane-directed row (never writable via the endpoint today).
    sessions.update(worker.id, {
      scheduledAt: Date.now() + 3600000,
      pendingPrompt: 'Leftover lane work',
      pendingInteractive: false,
    });

    await handleTurnCompletion(worker.id, '/tmp/test-detached', completionStubs());

    expect(sessions.getById(worker.id).status).not.toBe('scheduled');
  });
});
