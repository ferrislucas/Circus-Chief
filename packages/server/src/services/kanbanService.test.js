import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock external dependencies
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

vi.mock('./templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn().mockResolvedValue('rendered prompt'),
  getRootSession: vi.fn((session) => session),
}));

vi.mock('./gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

vi.mock('./sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./sessionProvider.js', () => ({
  resolveAgentTypeFromModel: vi.fn().mockReturnValue('codex'),
  resolveProviderMetadataFromModel: vi.fn().mockReturnValue({
    kind: 'openai', authToken: 'test-key', commitAttributionOverride: null,
    supportsIdempotentDispatch: true,
  }),
}));

// Passthrough by default so pause-abandon tests keep real worktree behavior;
// individual tests hold cleanup with mockImplementationOnce.
vi.mock('./gitService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, removeWorktree: vi.fn((...args) => actual.removeWorktree(...args)) };
});

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  sessionTemplates,
  databaseManager,
} from '../database.js';
import { broadcastToProject, broadcastToSession } from '../websocket.js';
import { runSession } from './sessionManager.js';
import { renderTemplatePrompt } from './templateTriggerService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  getFullBoard,
  addSessionToBoard,
  moveCard,
  routeWorkspaceCard,
  removeCard,
  removeLane,
  removeBoard,
  removeBoardForProject,
  removeSessionFromBoard,
  triggerStructuredTransitionAutomation,
  triggerLaneEntryAutomation,
  drainQueuedEntries,
  parkPendingEntriesForLane,
  drainLaneEntryTrigger,
  reclaimExpiredLaneEntryClaims,
  updateLaneWithAutomationToggle,
  scheduleLaneEntryDeliveries,
} from './kanbanService.js';
import * as gitService from './gitService.js';
import {
  beginWorkflowTurn, claimWorkflowSessionStart, createLaneRunForEntry, attachRootSession,
  finalizeOwnWorkCompletion, getRun, attemptLaneRunTransition, enqueueDisabledEntry,
} from './workflowSessionService.js';
import { reconcileKanbanOwnership } from './kanbanRecoveryService.js';
import { recoverOrphanedStartingSessions, recoverOrphanedRunningSessions } from './sessionStartupRecovery.js';
import { resolveProviderMetadataFromModel } from './sessionProvider.js';
import { kanbanRoutingMetrics } from './kanbanRoutingObservability.js';

describe('kanbanService', () => {
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();
    kanbanRoutingMetrics.reset();
    process.env.USE_CODEX_DIRECT_API = '1';
    resolveProviderMetadataFromModel.mockReturnValue({
      kind: 'openai', authToken: 'test-key', commitAttributionOverride: null,
      supportsIdempotentDispatch: true,
    });

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = kanbanBoards.create(projectId);
    boardId = board.id;
    lanes = kanbanLanes.getByBoardId(boardId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
  }

  function createChildSession(parentId, name = 'Child Session') {
    return sessions.create(projectId, name, 'Child Prompt', {
      mode: 'standard',
      parentSessionId: parentId,
    });
  }

  /** Card in lanes[0] with an open lane run and an attached worker child. */
  function setupActiveLaneRunCard() {
    const root = createSession('Root');
    const card = kanbanCards.create(lanes[0].id, root.id);
    const lane = { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'Do the work' };
    const run = createLaneRunForEntry({ projectId, workspaceId: root.id, cardId: card.id, lane });
    const worker = createChildSession(root.id, 'Lane worker');
    attachRootSession(run.id, worker.id);
    return { root, card, run, worker, rootId: root.id };
  }

  describe('routeWorkspaceCard current-lane requests', () => {
    it('is a no-op during an owning run and cannot restart the current structured lane on completion', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', completionTargetLaneId: lanes[1].id });
      const { root, card, run } = setupActiveLaneRunCard();
      const before = kanbanCards.getById(card.id);

      await expect(routeWorkspaceCard(root.id, lanes[0].id)).resolves.toEqual({ status: 'noop', laneId: lanes[0].id });

      expect(kanbanCards.getById(card.id)).toEqual(before);
      expect(getRun(run.id).chosenExitLaneId).toBeNull();
      expect(broadcastToProject).not.toHaveBeenCalled();

      attemptLaneRunTransition(run.id);

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(databaseManager.get().prepare("SELECT COUNT(*) count FROM kanban_lane_runs WHERE status='open'").get().count).toBe(0);
    });

    it('is a no-op without an active run', async () => {
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[0].id, workspace.id);
      const before = kanbanCards.getById(card.id);

      await expect(routeWorkspaceCard(workspace.id, lanes[0].id)).resolves.toEqual({ status: 'noop', laneId: lanes[0].id });

      expect(kanbanCards.getById(card.id)).toEqual(before);
      expect(broadcastToProject).not.toHaveBeenCalled();
      expect(databaseManager.get().prepare('SELECT COUNT(*) count FROM kanban_lane_runs').get().count).toBe(0);
    });
  });

  describe('routeWorkspaceCard manual moves with an open lane run', () => {
    it('immediately moves, supersedes the source run, and never selects a deferred exit lane', async () => {
      const { root, card, run } = setupActiveLaneRunCard();
      databaseManager.get().prepare('UPDATE kanban_lane_runs SET chosen_exit_lane_id=? WHERE id=?')
        .run(lanes[2].id, run.id);

      await expect(routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true }))
        .resolves.toEqual({ status: 'moved', laneId: lanes[1].id });

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(getRun(run.id)).toMatchObject({ status: 'superseded', chosenExitLaneId: lanes[2].id });
      expect(broadcastToProject).toHaveBeenCalledTimes(1);
      expect(broadcastToProject).toHaveBeenCalledWith(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, expect.objectContaining({
        cardId: card.id, fromLaneId: lanes[0].id, toLaneId: lanes[1].id,
      }));
    });

    it('preserves a source worker\'s lifecycle and pending schedule while revoking its card authority', async () => {
      const { root, card, run, worker } = setupActiveLaneRunCard();
      const scheduledAt = Date.now() + 60_000;
      databaseManager.get().prepare(`UPDATE sessions SET status='scheduled', scheduled_at=?, pending_prompt=?,
        pending_interactive=1, auto_send_pending_prompt=1,
        reschedule_count=2 WHERE id=?`)
        .run(scheduledAt, 'Continue independently', worker.id);

      await routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true });

      const preservedWorker = sessions.getById(worker.id);
      expect(preservedWorker).toMatchObject({
        laneRunId: null,
        ownWorkState: 'open',
        status: 'scheduled',
        scheduledAt,
        pendingPrompt: 'Continue independently',
        pendingInteractive: true,
        autoSendPendingPrompt: true,
        rescheduleCount: 2,
      });
      expect(claimWorkflowSessionStart(worker.id)).toBe(true);

      attemptLaneRunTransition(run.id);
      expect(getRun(run.id).status).toBe('superseded');
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
    });
  });

  describe('routeWorkspaceCard observability', () => {
    it('durably audits direct, manual, and no-op route decisions with routing context', async () => {
      const direct = createSession('Direct workspace');
      kanbanCards.create(lanes[0].id, direct.id);
      const { root, run } = setupActiveLaneRunCard();

      await routeWorkspaceCard(direct.id, lanes[1].id, { callerSessionId: 'caller-direct' });
      await routeWorkspaceCard(root.id, lanes[1].id, { callerSessionId: 'caller-manual', manualMove: true });
      await routeWorkspaceCard(root.id, lanes[2].id, { callerSessionId: 'caller-second-move', manualMove: true });
      await routeWorkspaceCard(root.id, lanes[2].id, { callerSessionId: 'caller-noop' });

      const records = databaseManager.get().prepare(`SELECT project_id, workspace_id, caller_session_id,
        source_lane_id, destination_lane_id, outcome, lane_run_id, request_at, committed_at
        FROM kanban_routing_audit_events ORDER BY request_at, rowid`).all();
      expect(records).toEqual([
        expect.objectContaining({ project_id: projectId, workspace_id: direct.id, caller_session_id: 'caller-direct',
          source_lane_id: lanes[0].id, destination_lane_id: lanes[1].id, outcome: 'moved', lane_run_id: null,
          request_at: expect.any(Number), committed_at: expect.any(Number) }),
        expect.objectContaining({ project_id: projectId, workspace_id: root.id, caller_session_id: 'caller-manual',
          source_lane_id: lanes[0].id, destination_lane_id: lanes[1].id, outcome: 'moved', lane_run_id: run.id,
          request_at: expect.any(Number), committed_at: expect.any(Number) }),
        expect.objectContaining({ project_id: projectId, workspace_id: root.id, caller_session_id: 'caller-second-move',
          source_lane_id: lanes[1].id, destination_lane_id: lanes[2].id, outcome: 'moved', lane_run_id: null,
          request_at: expect.any(Number), committed_at: expect.any(Number) }),
        expect.objectContaining({ project_id: projectId, workspace_id: root.id, caller_session_id: 'caller-noop',
          source_lane_id: lanes[2].id, destination_lane_id: lanes[2].id, outcome: 'noop', lane_run_id: null,
          request_at: expect.any(Number), committed_at: expect.any(Number) }),
      ]);
    });

    it('counts every accepted immediate move and no-op', async () => {
      const { root } = setupActiveLaneRunCard();

      await routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true });
      await routeWorkspaceCard(root.id, lanes[2].id, { manualMove: true });
      await routeWorkspaceCard(root.id, lanes[2].id);

      expect(kanbanRoutingMetrics.snapshot()).toMatchObject({
        accepted: { moved: 2, noop: 1 },
        overwritten: 0,
      });
    });
  });

  describe('routeWorkspaceCard stale lane-run pointers', () => {
    it('supersedes the open run before entering a structured destination when the active pointer is stale', async () => {
      const { root, card, run } = setupActiveLaneRunCard();
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Start destination work' });
      databaseManager.get().prepare('UPDATE kanban_cards SET active_lane_run_id=? WHERE id=?')
        .run('stale-run-pointer', card.id);

      await expect(routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true }))
        .resolves.toEqual({ status: 'moved', laneId: lanes[1].id });

      const movedCard = kanbanCards.getById(card.id);
      const destinationRun = getRun(movedCard.activeLaneRunId);
      expect(movedCard.laneId).toBe(lanes[1].id);
      expect(getRun(run.id)).toMatchObject({ status: 'superseded' });
      expect(destinationRun).toMatchObject({ status: 'open', sourceLaneId: lanes[1].id });
      expect(databaseManager.get().prepare("SELECT COUNT(*) count FROM kanban_lane_runs WHERE card_id=? AND status='open'")
        .get(card.id).count).toBe(1);
      expect(databaseManager.get().prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?')
        .get(destinationRun.laneEntryEventId)).toMatchObject({ lane_id: lanes[1].id });
    });

    it('rolls back the card move and run repair when destination run creation fails', async () => {
      const { root, card, run } = setupActiveLaneRunCard();
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Start destination work' });
      databaseManager.get().prepare('UPDATE kanban_cards SET active_lane_run_id=? WHERE id=?')
        .run('stale-run-pointer', card.id);
      databaseManager.get().exec(`CREATE TRIGGER fail_destination_lane_run
        BEFORE INSERT ON kanban_lane_runs WHEN NEW.source_lane_id = '${lanes[1].id}'
        BEGIN SELECT RAISE(ABORT, 'destination run creation failed'); END`);

      await expect(routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true })).rejects.toThrow('destination run creation failed');

      expect(kanbanCards.getById(card.id)).toMatchObject({ laneId: lanes[0].id, activeLaneRunId: 'stale-run-pointer' });
      expect(getRun(run.id)).toMatchObject({ status: 'open' });
      expect(databaseManager.get().prepare('SELECT COUNT(*) count FROM kanban_lane_runs WHERE card_id=?').get(card.id).count).toBe(1);
      expect(databaseManager.get().prepare('SELECT COUNT(*) count FROM kanban_lane_entry_events WHERE card_id=?').get(card.id).count).toBe(1);
    });
  });

  describe('routeWorkspaceCard SQLite contention and conditional races', () => {
    it.each(['SQLITE_BUSY', 'SQLITE_LOCKED'])('retries %s and succeeds once contention clears', async (code) => {
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[0].id, workspace.id);
      const immediateTransaction = vi.spyOn(databaseManager, 'immediateTransaction')
        .mockImplementationOnce(() => {
          const error = new Error('database is locked');
          error.code = code;
          throw error;
        });

      await expect(routeWorkspaceCard(workspace.id, lanes[1].id))
        .resolves.toEqual({ status: 'moved', laneId: lanes[1].id });

      expect(immediateTransaction).toHaveBeenCalledTimes(2);
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      immediateTransaction.mockRestore();
    });

    it('returns a retryable service error after bounded SQLite contention retries are exhausted', async () => {
      const workspace = createSession('Workspace');
      kanbanCards.create(lanes[0].id, workspace.id);
      const immediateTransaction = vi.spyOn(databaseManager, 'immediateTransaction')
        .mockImplementation(() => {
          const error = new Error('database is busy');
          error.code = 'SQLITE_BUSY';
          throw error;
        });

      await expect(routeWorkspaceCard(workspace.id, lanes[1].id)).rejects.toMatchObject({
        status: 503,
        code: 'KANBAN_ROUTE_RETRYABLE',
      });

      expect(immediateTransaction.mock.calls.length).toBeGreaterThan(1);
      immediateTransaction.mockRestore();
    });

    it('does not write a deferred exit lane for an active run', async () => {
      const { root, run } = setupActiveLaneRunCard();

      await expect(routeWorkspaceCard(root.id, lanes[1].id, { manualMove: true }))
        .resolves.toEqual({ status: 'moved', laneId: lanes[1].id });

      expect(getRun(run.id).chosenExitLaneId).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
    });
  });

  // ── getFullBoard ───────────────────────────────────────────────────

  describe('getFullBoard', () => {
    it('returns full board with lanes and cards', () => {
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const board = getFullBoard(projectId);

      expect(board).not.toBeNull();
      expect(board.projectId).toBe(projectId);
      expect(board.lanes).toHaveLength(4);
      expect(board.lanes[0].cards).toHaveLength(1);
      expect(board.lanes[0].cards[0].sessions[0].id).toBe(session.id);
    });

    it('returns null when project does not exist', () => {
      const board = getFullBoard('non-existent');
      expect(board).toBeNull();
    });

    it('lazy-creates board if none exists', () => {
      const project2 = projects.create('Project 2', '/tmp/test2');
      const board = getFullBoard(project2.id);

      expect(board).not.toBeNull();
      expect(board.lanes).toHaveLength(4);
    });

    it('groups cards into their correct lanes', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const s3 = createSession('S3');
      kanbanCards.create(lanes[0].id, s1.id);
      kanbanCards.create(lanes[0].id, s2.id);
      kanbanCards.create(lanes[2].id, s3.id);

      const board = getFullBoard(projectId);

      expect(board.lanes[0].cards).toHaveLength(2);
      expect(board.lanes[1].cards).toHaveLength(0);
      expect(board.lanes[2].cards).toHaveLength(1);
      expect(board.lanes[3].cards).toHaveLength(0);
    });
  });

  // ── addSessionToBoard ──────────────────────────────────────────────

  describe('addSessionToBoard', () => {
    it('rolls back the card and lane-entry intent when operation finalization fails', async () => {
      const session = createSession();

      await expect(addSessionToBoard(session.id, lanes[0].id, {
        finalizeMutation: () => { throw new Error('operation ownership lost'); },
      })).rejects.toThrow('operation ownership lost');

      expect(kanbanCards.getBySessionId(session.id)).toBeNull();
      expect(databaseManager.get().prepare(
        'SELECT COUNT(*) AS count FROM kanban_lane_entry_events WHERE workspace_id=?'
      ).get(session.id).count).toBe(0);
    });

    it('rolls back the card when durable lane-entry intent cannot be recorded', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const session = createSession();
      const db = databaseManager.get();
      db.exec(`CREATE TRIGGER fail_lane_entry_event_insert BEFORE INSERT ON kanban_lane_entry_events
        BEGIN SELECT injected_lane_entry_event_failure(); END;`);

      try {
        await expect(addSessionToBoard(session.id, lanes[0].id)).rejects.toThrow('no such function: injected_lane_entry_event_failure');
        expect(kanbanCards.getBySessionId(session.id)).toBeNull();
      } finally {
        db.exec('DROP TRIGGER IF EXISTS fail_lane_entry_event_insert');
      }
    });

    it('adds a session to a lane', async () => {
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);

      expect(card).not.toBeNull();
      expect(card.laneId).toBe(lanes[0].id);
      expect(card.sessions[0].id).toBe(session.id);
    });

    it('broadcasts KANBAN_CARD_ADDED', async () => {
      const session = createSession();
      await addSessionToBoard(session.id, lanes[0].id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({
          projectId,
          laneId: lanes[0].id,
        })
      );
    });

    it('throws when session already has a card', async () => {
      const session = createSession();
      await addSessionToBoard(session.id, lanes[0].id);

      await expect(addSessionToBoard(session.id, lanes[1].id)).rejects.toThrow(
        'Session already has a card on the board'
      );
    });

    it('triggers lane on-enter prompt when creating a card in a lane', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const session = createSession();

      await addSessionToBoard(session.id, lanes[0].id);

      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);
      expect(childSession).toBeDefined();
      expect(childSession.parentSessionId).toBe(session.id);
      expect(runSession).toHaveBeenCalled();
    });

    it('skips lane on-enter prompt when runOnEnterTemplate is false', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const session = createSession();

      const card = await addSessionToBoard(session.id, lanes[0].id, { runOnEnterTemplate: false });

      const allSessions = sessions.getByProjectId(projectId);
      expect(allSessions).toHaveLength(1);
      expect(runSession).not.toHaveBeenCalled();
      expect(databaseManager.get().prepare('SELECT count(*) AS count FROM kanban_lane_runs').get().count).toBe(0);
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
    });

    it('normalizes a child session id to the workspace root', async () => {
      const root = createSession('Root');
      const child = createChildSession(root.id);

      const card = await addSessionToBoard(child.id, lanes[0].id);

      // Card is keyed to the root, not the child
      expect(card.sessions[0].id).toBe(root.id);
      expect(kanbanCards.getBySessionId(root.id)).not.toBeNull();
      expect(kanbanCards.getBySessionId(child.id)).toBeNull();
    });

    it('throws duplicate error when root already has a card and child id is passed', async () => {
      const root = createSession('Root');
      const child = createChildSession(root.id);
      await addSessionToBoard(root.id, lanes[0].id);

      await expect(addSessionToBoard(child.id, lanes[1].id)).rejects.toThrow(
        'Session already has a card on the board'
      );
    });

    // Hard-cutover contract (KanbanLaneRepository#assertConfiguration): a
    // lane cannot even carry a completion target without on-entry automation
    // any more, so the "target-only lane opens an orphaned, rootless run"
    // failure mode this used to regression-test can no longer be constructed.
    // See KanbanLaneRepository.test.js's "rejects a completion target when
    // the lane has no on-entry automation" for the current guard.
    it('does not open a lane run for a plain lane with neither automation nor a target', async () => {
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);

      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
    });

    it('commits the board mutation even when asynchronous entry delivery fails', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Failing entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      renderTemplatePrompt.mockRejectedValueOnce(new Error('template unavailable'));
      const session = createSession();

      const card = await addSessionToBoard(session.id, lanes[0].id);

      expect(kanbanCards.getById(card.id)).not.toBeNull();
      const event = databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE card_id=?').get(card.id);
      expect(['pending', 'claimed']).toContain(event.status);
    });

    it('does not complete an entry event when provider dispatch rejects asynchronously', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Rejected dispatch', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      runSession.mockRejectedValueOnce(new Error('provider unavailable'));

      const card = await addSessionToBoard(createSession().id, lanes[0].id);

      await vi.waitFor(() => {
        const event = databaseManager.get().prepare('SELECT status, last_error FROM kanban_lane_entry_events WHERE card_id=?').get(card.id);
        expect(event.status).toBe('pending');
        expect(event.last_error).toContain('provider dispatch was not accepted');
      });
    });
  });

  // ── Disabled lane queues instead of firing ─────────────────────────

  describe('disabled lane entry queueing', () => {
    function disableLaneWithPrompt(laneId) {
      kanbanLanes.update(laneId, { onEnterPrompt: 'do something', automationEnabled: false });
      return kanbanLanes.getById(laneId);
    }

    function queuedEventsForCard(cardId) {
      return databaseManager.get().prepare(
        'SELECT * FROM kanban_lane_entry_events WHERE card_id=? ORDER BY created_at'
      ).all(cardId);
    }

    it('queues addSessionToBoard arrivals without spawning sessions', async () => {
      disableLaneWithPrompt(lanes[0].id);
      const session = createSession();
      const sessionsBefore = sessions.getByProjectId(projectId).length;

      const card = await addSessionToBoard(session.id, lanes[0].id);

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[0].id);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      expect(runSession).not.toHaveBeenCalled();
      expect(databaseManager.get().prepare('SELECT COUNT(*) AS count FROM kanban_lane_runs').get().count).toBe(0);
      const events = queuedEventsForCard(card.id);
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('queued');
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
    });

    it('broadcasts KANBAN_CARD_ADDED and KANBAN_ENTRY_QUEUED on queued add', async () => {
      disableLaneWithPrompt(lanes[0].id);
      const session = createSession();

      await addSessionToBoard(session.id, lanes[0].id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({ projectId, laneId: lanes[0].id })
      );
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED,
        expect.objectContaining({ projectId, laneId: lanes[0].id })
      );
    });

    it('queues moveCard arrivals without spawning sessions', async () => {
      disableLaneWithPrompt(lanes[1].id);
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const sessionsBefore = sessions.getByProjectId(projectId).length;

      await moveCard(card.id, lanes[1].id);

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      expect(runSession).not.toHaveBeenCalled();
      const events = queuedEventsForCard(card.id);
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('queued');
      expect(events[0].cause).toBe('manual_move');
    });

    it('queues routeWorkspaceCard arrivals without spawning sessions', async () => {
      disableLaneWithPrompt(lanes[1].id);
      const session = createSession();
      await addSessionToBoard(session.id, lanes[0].id);
      const sessionsBefore = sessions.getByProjectId(projectId).length;

      const response = await routeWorkspaceCard(session.id, lanes[1].id, { manualMove: true });

      expect(response.status).toBe('moved');
      expect(kanbanCards.getBySessionId(session.id).laneId).toBe(lanes[1].id);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      const events = queuedEventsForCard(kanbanCards.getBySessionId(session.id).id);
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('queued');
    });

    it('collapses same-lane re-arrivals to a single queued entry', async () => {
      disableLaneWithPrompt(lanes[0].id);
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);

      await moveCard(card.id, lanes[0].id);

      expect(queuedEventsForCard(card.id)).toHaveLength(1);
    });

    it('triggerLaneEntryAutomation is a no-op for a disabled lane', async () => {
      disableLaneWithPrompt(lanes[0].id);
      const session = createSession();

      const result = await triggerLaneEntryAutomation(session.id, lanes[0].id);

      expect(result).toEqual({ delivered: false, reason: 'lane_automation_disabled' });
      expect(runSession).not.toHaveBeenCalled();
    });
  });

  // ── Re-enable drains FIFO; worker parks ────────────────────────────

  describe('re-enable drain and worker park', () => {
    function disableLaneWithPrompt(laneId) {
      kanbanLanes.update(laneId, { onEnterPrompt: 'do something', automationEnabled: false });
      return kanbanLanes.getById(laneId);
    }

    it('drains queued entries FIFO with runs created in arrival order', async () => {
      disableLaneWithPrompt(lanes[0].id);
      const cardA = await addSessionToBoard(createSession('A').id, lanes[0].id);
      const cardB = await addSessionToBoard(createSession('B').id, lanes[0].id);
      const cardC = await addSessionToBoard(createSession('C').id, lanes[0].id);
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });

      const { drainedCount, eventIds } = drainQueuedEntries(lanes[0].id);

      expect(drainedCount).toBe(3);
      expect(eventIds).toHaveLength(3);
      const db = databaseManager.get();
      // Runs are created synchronously in drain order, before delivery resumes.
      const runCardOrder = db.prepare('SELECT card_id FROM kanban_lane_runs ORDER BY rowid').all()
        .map((row) => row.card_id);
      expect(runCardOrder).toEqual([cardA.id, cardB.id, cardC.id]);
      for (const card of [cardA, cardB, cardC]) {
        expect(kanbanCards.getById(card.id).activeLaneRunId).not.toBeNull();
      }
      // Detached delivery then completes every drained entry.
      await vi.waitFor(() => {
        for (const card of [cardA, cardB, cardC]) {
          expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE card_id=?').get(card.id).status)
            .toBe('completed');
        }
      });
    });

    it('drains nothing when the queue is empty', () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });

      expect(drainQueuedEntries(lanes[0].id)).toEqual({ drainedCount: 0, eventIds: [] });
      expect(runSession).not.toHaveBeenCalled();
    });

    it('removes the queued entry when its card moves out before re-enable', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);
      expect(databaseManager.get().prepare('SELECT COUNT(*) AS count FROM kanban_lane_entry_events WHERE card_id=?')
        .get(card.id).count).toBe(1);

      await moveCard(card.id, lanes[1].id);

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(databaseManager.get().prepare('SELECT COUNT(*) AS count FROM kanban_lane_entry_events WHERE card_id=?')
        .get(card.id).count).toBe(0);
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(0);
    });

    it('moves the queued entry when routed between disabled lanes', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'do something else', automationEnabled: false });
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);

      await moveCard(card.id, lanes[1].id);

      const db = databaseManager.get();
      const events = db.prepare('SELECT * FROM kanban_lane_entry_events WHERE card_id=?').all(card.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ status: 'queued', lane_id: lanes[1].id, cause: 'manual_move' });
      expect(runSession).not.toHaveBeenCalled();
      kanbanLanes.update(lanes[1].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[1].id).drainedCount).toBe(1);
    });

    it('queues completion entries targeting a disabled lane and resumes the chain on re-enable', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Source work', completionTargetLaneId: lanes[1].id });
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Target work', automationEnabled: false });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'Source work', completionTargetLaneId: lanes[1].id },
      });
      const worker = createChildSession(root.id, 'Worker');
      attachRootSession(run.id, worker.id);
      // The target lane's chain destination is read at drain time, not arrival.
      kanbanLanes.update(lanes[1].id, { completionTargetLaneId: lanes[2].id });

      const reconciled = finalizeOwnWorkCompletion(worker.id, beginWorkflowTurn(worker.id));

      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(reconciled.pendingTargetLaneTrigger).toBeUndefined();
      const db = databaseManager.get();
      const queued = db.prepare("SELECT * FROM kanban_lane_entry_events WHERE card_id=? AND cause='completion'")
        .get(card.id);
      expect(queued).toMatchObject({
        status: 'queued', lane_id: lanes[1].id, caused_by_run_id: run.id,
      });
      expect(databaseManager.get().prepare('SELECT COUNT(*) AS count FROM kanban_lane_runs WHERE card_id=?')
        .get(card.id).count).toBe(1);
      expect(reconciled.queuedCompletionEntry).toMatchObject({ laneId: lanes[1].id });
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId, WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED,
        expect.objectContaining({ cardId: card.id, laneId: lanes[1].id })
      );

      kanbanLanes.update(lanes[1].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[1].id).drainedCount).toBe(1);
      const successor = db.prepare('SELECT * FROM kanban_lane_runs WHERE card_id=? AND id != ?').get(card.id, run.id);
      expect(successor.completion_target_lane_id).toBe(lanes[2].id);
    });

    it('parks pending entries back to queued while leaving open runs untouched', () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const db = databaseManager.get();
      const runs = ['Park A', 'Park B'].map((name) => {
        const s = createSession(name);
        const c = kanbanCards.create(lanes[0].id, s.id);
        return createLaneRunForEntry({
          projectId, workspaceId: s.id, cardId: c.id,
          lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'do something' },
        });
      });
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });

      expect(parkPendingEntriesForLane(lanes[0].id)).toEqual({ parkedCount: 2 });

      for (const run of runs) {
        const event = db.prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId);
        expect(event.status).toBe('queued');
        expect(event.attempt_count).toBe(0);
        expect(getRun(run.id).status).toBe('open');
      }
      expect(parkPendingEntriesForLane(lanes[0].id)).toEqual({ parkedCount: 0 });
    });

    it('parks worker delivery on a disabled lane without attempts or audits', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const lane = { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'do something' };
      const run = createLaneRunForEntry({ projectId, workspaceId: root.id, cardId: card.id, lane });
      const sessionsBefore = sessions.getByProjectId(projectId).length;
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });

      const delivered = await drainLaneEntryTrigger(run.laneEntryEventId);

      expect(delivered).toBe(false);
      const db = databaseManager.get();
      const event = db.prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId);
      expect(event.status).toBe('queued');
      expect(event.attempt_count).toBe(0);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      expect(runSession).not.toHaveBeenCalled();
      const audits = db.prepare('SELECT event_type FROM kanban_lane_run_audit_events WHERE lane_run_id=?')
        .all(run.id).map((row) => row.event_type);
      expect(audits).toEqual(['run_created']);
    });
  });

  // ── Kill-switch race: disable mid-async-setup (FR-2, AC-5) ─────────

  describe('kill-switch race during async setup', () => {
    function enabledLaneWithPrompt(laneId) {
      kanbanLanes.update(laneId, { onEnterPrompt: 'do something' });
      return kanbanLanes.getById(laneId);
    }

    function eventRow(eventId) {
      return databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(eventId);
    }

    it('creates no child when the lane is disabled during prompt rendering', async () => {
      enabledLaneWithPrompt(lanes[0].id);
      // An already-accepted dispatch must survive the later disable.
      const rootA = createSession('A');
      const cardA = kanbanCards.create(lanes[0].id, rootA.id);
      const runA = createLaneRunForEntry({
        projectId, workspaceId: rootA.id, cardId: cardA.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      expect(await drainLaneEntryTrigger(runA.laneEntryEventId)).toBe(true);

      const rootB = createSession('B');
      const cardB = kanbanCards.create(lanes[0].id, rootB.id);
      const runB = createLaneRunForEntry({
        projectId, workspaceId: rootB.id, cardId: cardB.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const sessionsBefore = sessions.getByProjectId(projectId).length;
      const { renderTemplatePrompt: render } = await import('./templateTriggerService.js');
      render.mockImplementationOnce(async () => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return 'rendered mid-race';
      });

      const delivered = await drainLaneEntryTrigger(runB.laneEntryEventId);

      expect(delivered).toBe(false);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      expect(runSession).toHaveBeenCalledTimes(1);
      expect(eventRow(runB.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
      // The already-accepted dispatch is preserved untouched.
      expect(eventRow(runA.laneEntryEventId).status).toBe('completed');
      expect(getRun(runA.id).status).toBe('open');
    });

    it('resumes a parked rootless run after a server restart', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });

      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(getRun(run.id).status).toBe('open');

      // Simulate a server restart: recovery must preserve the paused
      // undelivered ownership instead of classifying it stale/superseded.
      reconcileKanbanOwnership({ dryRun: false });
      expect(getRun(run.id).status).toBe('open');

      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId).status).toBe('completed');
      });
      expect(runSession).toHaveBeenCalledTimes(1);
    });

    it('replaces a terminal husk left behind a queued entry instead of failing delivery', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      // Legacy damage: an older recovery superseded the paused rootless run.
      databaseManager.get().prepare("UPDATE kanban_lane_runs SET status='superseded', superseded_at=? WHERE id=?")
        .run(Date.now(), run.id);

      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId).status).toBe('completed');
      });
      const replacement = databaseManager.get().prepare(
        "SELECT * FROM kanban_lane_runs WHERE lane_entry_event_id=? AND status='open'").get(run.laneEntryEventId);
      expect(replacement).toBeTruthy();
      expect(replacement.id).not.toBe(run.id);
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBe(replacement.id);
    });

    it('removes the undispatched child when the lane is disabled during git setup', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const sessionsBefore = sessions.getByProjectId(projectId).length;
      const { setupGitForSession } = await import('./gitSessionSetup.js');
      const originalSetup = setupGitForSession.getMockImplementation()
        || (async () => ({ workingDirectory: '/tmp/test', gitWorktree: null }));
      setupGitForSession.mockImplementationOnce(async (...args) => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return originalSetup(...args);
      });

      const delivered = await drainLaneEntryTrigger(run.laneEntryEventId);

      expect(delivered).toBe(false);
      expect(sessions.getByProjectId(projectId)).toHaveLength(sessionsBefore);
      expect(runSession).not.toHaveBeenCalled();
      expect(eventRow(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
      // The abandoned run is rootless again so the parked entry can resume.
      expect(databaseManager.get().prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?')
        .get(run.id).root_session_id).toBeNull();
    });

    // ── PR #1166 findings 4–5: pause-abandon cleanup ────────────────
    // These tests drive the real git worktree allocation (not the mocked
    // setupGitForSession) so orphaned worktrees and phantom sessions surface.
    describe('pause-abandon cleanup (real worktree allocation)', () => {
      let repoDir;
      let worktreeRoot;
      let previousWorktreeRoot;
      let setupGitMock;

      function initGitRepo() {
        const dir = mkdtempSync(join(tmpdir(), 'kanban-wt-repo-'));
        execSync('git init', { cwd: dir, stdio: 'ignore' });
        execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
        execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
        execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
        return dir;
      }

      function worktreeList() {
        return execSync('git worktree list --porcelain', { cwd: repoDir }).toString();
      }

      beforeEach(async () => {
        repoDir = initGitRepo();
        worktreeRoot = mkdtempSync(join(tmpdir(), 'kanban-wt-root-'));
        previousWorktreeRoot = process.env.CIRCUS_TEST_WORKTREE_ROOT;
        process.env.CIRCUS_TEST_WORKTREE_ROOT = worktreeRoot;
        // Keep local-only git probes fast: no origin exists in these repos.
        process.env.GH_REPO_VIEW_TIMEOUT_MS = '1000';
        process.env.GIT_FETCH_TIMEOUT_MS = '1000';
        projects.update(projectId, { workingDirectory: repoDir });
        // Delegate to the real git setup for the duration of these tests.
        const actual = await vi.importActual('./gitSessionSetup.js');
        ({ setupGitForSession: setupGitMock } = await import('./gitSessionSetup.js'));
        setupGitMock.mockImplementation((...args) => actual.setupGitForSession(...args));
      });

      afterEach(() => {
        if (previousWorktreeRoot === undefined) delete process.env.CIRCUS_TEST_WORKTREE_ROOT;
        else process.env.CIRCUS_TEST_WORKTREE_ROOT = previousWorktreeRoot;
        delete process.env.GH_REPO_VIEW_TIMEOUT_MS;
        delete process.env.GIT_FETCH_TIMEOUT_MS;
        // Restore the module-wide mocked setup so later suites keep their fixture.
        setupGitMock?.mockReset();
        setupGitMock?.mockResolvedValue({ workingDirectory: '/tmp/test', gitWorktree: null });
        // Best-effort cleanup: a failing implementation may leave worktrees behind.
        try {
          if (repoDir) execSync('git worktree prune', { cwd: repoDir, stdio: 'ignore' });
        } catch { /* ignore */ }
        for (const dir of [repoDir, worktreeRoot]) {
          try {
            if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
          } catch { /* ignore */ }
        }
      });

      it('releases a template-allocated worktree on pause-abandon and resumes cleanly on re-enable', async () => {
        const template = sessionTemplates.create({
          projectId, name: 'Entry', prompt: 'do something', gitMode: 'worktree', gitBranch: 'lane-feature',
        });
        kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
        const root = createSession('Root');
        const card = kanbanCards.create(lanes[0].id, root.id);
        const run = createLaneRunForEntry({
          projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
        });
        const { setupGitForSession } = await import('./gitSessionSetup.js');
        setupGitForSession.mockImplementationOnce(async (...args) => {
          // Disable mid-setup: the post-setup pause fence must park the entry.
          kanbanLanes.update(lanes[0].id, { automationEnabled: false });
          const actual = await vi.importActual('./gitSessionSetup.js');
          return actual.setupGitForSession(...args);
        });

        expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

        // (a) No orphaned worktree remains registered or on disk for the abandoned child.
        expect(worktreeList()).not.toContain(worktreeRoot);
        expect(readdirSync(worktreeRoot)).toHaveLength(0);
        expect(sessions.getByProjectId(projectId).map((s) => s.name))
          .not.toContain(expect.stringContaining('Entry'));

        // (b) Re-enable dispatches successfully with no branch-already-checked-out failure.
        kanbanLanes.update(lanes[0].id, { automationEnabled: true });
        expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
        await vi.waitFor(() => {
          expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
            .get(run.laneEntryEventId).status).toBe('completed');
        });
        expect(runSession).toHaveBeenCalledTimes(1);
        const registered = worktreeList().split('\n').filter((line) => line.startsWith('worktree '));
        expect(registered.filter((line) => line.includes(worktreeRoot))).toHaveLength(1);

        // (c) A second pause cycle still leaves no leaked directories/worktrees.
        expect(readdirSync(worktreeRoot)).toHaveLength(1);
      });

      it('leaves an inherited worktree untouched when its published child is abandoned', async () => {
        // Parent owns a real worktree; the child inherits it (no fresh allocation).
        const actual = await vi.importActual('./gitSessionSetup.js');
        const parentSetup = await actual.setupGitForSession({
          projectDir: repoDir, gitMode: 'worktree', gitBranch: 'shared-feature', sessionId: 'parent-wt',
        });
        const root = createSession('Root');
        sessions.update(root.id, { gitWorktree: parentSetup.gitWorktree });
        kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
        const card = kanbanCards.create(lanes[0].id, root.id);
        const run = createLaneRunForEntry({
          projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
        });
        // Disable at the provider boundary (after SESSION_CREATED): the
        // provider fence rejects, and the published child must be abandoned.
        runSession.mockImplementationOnce(async (childId, prompt, workingDirectory, opts) => {
          kanbanLanes.update(lanes[0].id, { automationEnabled: false });
          await opts.beforeProviderExecute();
        });

        expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

        // The shared worktree survives the abandon; only the child row is gone.
        expect(existsSync(parentSetup.gitWorktree)).toBe(true);
        expect(worktreeList()).toContain(parentSetup.gitWorktree);
        expect(sessions.getById(root.id)).toBeTruthy();
      });

      // ── PR #1166 finding 9: retry-time pause must preserve the reused child ──
      // A redelivery reuses its existing child. Pausing mid-retry must keep
      // that child/root together for resume — never detach it without cleanup
      // (leaked child + leaked worktree + phantom run member + failed resume).

      it('preserves a reused template child across retry-time pause and resumes with it on re-enable', async () => {
        const template = sessionTemplates.create({
          projectId, name: 'Entry', prompt: 'do something', gitMode: 'worktree', gitBranch: 'lane-feature',
        });
        kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
        const root = createSession('Root');
        const card = kanbanCards.create(lanes[0].id, root.id);
        const run = createLaneRunForEntry({
          projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
        });
        // Pre-dispatch setup failure: attached child C1 + retryable event, no
        // dispatch intent recorded.
        const child = createChildSession(root.id, 'Entry (lane: To Do)');
        attachRootSession(run.id, child.id);

        // Retry reuses C1 and allocates its worktree; the lane is disabled
        // during that async setup.
        const { setupGitForSession } = await import('./gitSessionSetup.js');
        setupGitForSession.mockImplementationOnce(async (...args) => {
          kanbanLanes.update(lanes[0].id, { automationEnabled: false });
          const actual = await vi.importActual('./gitSessionSetup.js');
          return actual.setupGitForSession(...args);
        });

        expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

        // Pause preserves the child/root together: no detach, no deletion.
        expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
        expect(databaseManager.get().prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?')
          .get(run.id).root_session_id).toBe(child.id);
        const preserved = sessions.getById(child.id);
        expect(preserved).toBeTruthy();
        expect(preserved.gitWorktree).toBeTruthy();
        expect(worktreeList()).toContain(preserved.gitWorktree);
        const deletions = [...broadcastToProject.mock.calls, ...broadcastToSession.mock.calls]
          .filter((call) => call[1] === WS_MESSAGE_TYPES.SESSION_DELETED
            && call[2]?.sessionId === child.id);
        expect(deletions).toHaveLength(0);

        // Re-enable resumes with the SAME child — exactly once, no duplicate
        // allocation, no branch-already-checked-out failure.
        kanbanLanes.update(lanes[0].id, { automationEnabled: true });
        expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
        await vi.waitFor(() => {
          expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
            .get(run.laneEntryEventId).status).toBe('completed');
        });
        expect(runSession).toHaveBeenCalledTimes(1);
        expect(sessions.getByProjectId(projectId).filter((s) => s.name.includes('Entry')))
          .toHaveLength(1);
        expect(databaseManager.get().prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?')
          .get(run.id).root_session_id).toBe(child.id);
      });

      it('preserves a reused prompt child across retry-time pause during rendering', async () => {
        kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
        const root = createSession('Root');
        const card = kanbanCards.create(lanes[0].id, root.id);
        const run = createLaneRunForEntry({
          projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
        });
        // Pre-dispatch setup failure: attached child C1 + retryable event.
        const child = createChildSession(root.id, 'Lane prompt (lane: To Do)');
        attachRootSession(run.id, child.id);

        // Retry-time pause during rendering: the child exists, no worktree yet.
        const { renderTemplatePrompt: render } = await import('./templateTriggerService.js');
        render.mockImplementationOnce(async () => {
          kanbanLanes.update(lanes[0].id, { automationEnabled: false });
          return 'rendered mid-race';
        });

        expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

        // No unnecessary detach: the child/root stay attached for resume.
        expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
        expect(databaseManager.get().prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?')
          .get(run.id).root_session_id).toBe(child.id);
        expect(sessions.getById(child.id)).toBeTruthy();
        const deletions = [...broadcastToProject.mock.calls, ...broadcastToSession.mock.calls]
          .filter((call) => call[1] === WS_MESSAGE_TYPES.SESSION_DELETED
            && call[2]?.sessionId === child.id);
        expect(deletions).toHaveLength(0);

        // Re-enable resumes with the SAME child exactly once.
        kanbanLanes.update(lanes[0].id, { automationEnabled: true });
        expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
        await vi.waitFor(() => {
          expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
            .get(run.laneEntryEventId).status).toBe('completed');
        });
        expect(runSession).toHaveBeenCalledTimes(1);
        expect(sessions.getByProjectId(projectId).filter((s) => s.name.includes('Lane prompt')))
          .toHaveLength(1);
        expect(databaseManager.get().prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?')
          .get(run.id).root_session_id).toBe(child.id);
      });

      it('emits SESSION_DELETED on project and session channels for a published child abandoned at the provider fence', async () => {
        kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
        const root = createSession('Root');
        const card = kanbanCards.create(lanes[0].id, root.id);
        const run = createLaneRunForEntry({
          projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
        });
        // Simulate prepareRunTurn publishing running state, then the provider
        // fence rejecting because the lane was disabled mid-setup.
        runSession.mockImplementationOnce(async (childId, prompt, workingDirectory, opts) => {
          broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
            projectId, sessionId: childId, status: 'running',
          });
          kanbanLanes.update(lanes[0].id, { automationEnabled: false });
          await opts.beforeProviderExecute();
        });

        expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

        const created = broadcastToProject.mock.calls.find(
          (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
        );
        expect(created).toBeTruthy();
        const childId = created[2].session.id;
        // The child row is gone …
        expect(sessions.getById(childId)).toBeNull();
        // … and mounted clients learn about it without a reload: the list/tree
        // channel and the open detail subscription both observe the deletion.
        expect(broadcastToProject).toHaveBeenCalledWith(
          projectId, WS_MESSAGE_TYPES.SESSION_DELETED,
          expect.objectContaining({ sessionId: childId })
        );
        expect(broadcastToSession).toHaveBeenCalledWith(
          childId, WS_MESSAGE_TYPES.SESSION_DELETED,
          expect.objectContaining({ sessionId: childId })
        );
      });
    });
  });

  // ── PR #1166 finding 7: superseded-entry revival ────────────────
  // A pending entry that survived a move-out (move-out deletes only queued
  // entries) must not revive once the card moved on: retrying it must spawn
  // nothing and preserve the newer entry's ownership.

  describe('superseded-entry revival (PR #1166 finding 7)', () => {
    function eventRow(eventId) {
      return databaseManager.get().prepare(
        'SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?'
      ).get(eventId);
    }

    it('does not revive a superseded entry once a newer entry completed', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run1 = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const event1 = run1.laneEntryEventId;

      // Move out to B: supersedes run1; the pending E1 survives the move-out.
      await moveCard(card.id, lanes[1].id);
      expect(getRun(run1.id).status).toBe('superseded');
      expect(eventRow(event1)).toEqual({ status: 'pending', attempt_count: 0 });

      // Move back to A: the newer entry E2 dispatches and completes.
      await moveCard(card.id, lanes[0].id);
      const event2 = kanbanCards.getById(card.id).laneEntryEventId;
      expect(event2).not.toBe(event1);
      await vi.waitFor(() => {
        expect(eventRow(event2)).toEqual({ status: 'completed', attempt_count: 1 });
      });
      const run2Id = kanbanCards.getById(card.id).activeLaneRunId;
      expect(getRun(run2Id).status).toBe('open');

      const dispatchesBefore = runSession.mock.calls.length;

      // Retrying the obsolete entry must spawn nothing and preserve ownership.
      await expect(drainLaneEntryTrigger(event1)).resolves.toBe(false);
      expect(runSession.mock.calls.length).toBe(dispatchesBefore);
      expect(eventRow(event1).status).toBe('invalid');
      expect(kanbanCards.getById(card.id)).toMatchObject({
        activeLaneRunId: run2Id, laneEntryEventId: event2,
      });
    });

    it('does not revive a superseded entry after move-out/back through an unautomated configuration', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run1 = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const event1 = run1.laneEntryEventId;

      // Template-rendering failure before child allocation: a rootless open
      // run paired with a retryable pending event.
      renderTemplatePrompt.mockRejectedValueOnce(new Error('render boom'));
      await expect(drainLaneEntryTrigger(event1)).rejects.toThrow();
      expect(getRun(run1.id)).toMatchObject({ status: 'open', rootSessionId: null });
      expect(eventRow(event1)).toEqual({ status: 'pending', attempt_count: 1 });

      // Move out to unautomated lane B: supersedes run1 with a persisted
      // reason and clears the card pointers; the pending E1 survives.
      await moveCard(card.id, lanes[1].id);
      expect(getRun(run1.id)).toMatchObject({ status: 'superseded', failureReason: 'card_moved' });
      expect(kanbanCards.getById(card.id)).toMatchObject({ activeLaneRunId: null, laneEntryEventId: null });

      // Clear A's automation, then move back while unautomated: neither move
      // creates a successor entry or run.
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null });
      const db = databaseManager.get();
      const eventsBefore = db.prepare('SELECT count(*) count FROM kanban_lane_entry_events WHERE card_id=?').get(card.id).count;
      const runsBefore = db.prepare('SELECT count(*) count FROM kanban_lane_runs WHERE card_id=?').get(card.id).count;
      await moveCard(card.id, lanes[0].id);
      expect(db.prepare('SELECT count(*) count FROM kanban_lane_entry_events WHERE card_id=?').get(card.id).count)
        .toBe(eventsBefore);
      expect(db.prepare('SELECT count(*) count FROM kanban_lane_runs WHERE card_id=?').get(card.id).count)
        .toBe(runsBefore);

      // Restore A's automation, then let the outbox retry fire after backoff:
      // retrying the old arrival must terminally consume it — never drop the
      // superseded run and dispatch a replacement.
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      db.prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?').run(event1);
      const dispatchesBefore = runSession.mock.calls.length;
      await expect(drainLaneEntryTrigger(event1)).resolves.toBe(false);
      expect(runSession.mock.calls.length).toBe(dispatchesBefore);
      expect(eventRow(event1).status).toBe('invalid');
      expect(getRun(run1.id)).toMatchObject({ status: 'superseded', failureReason: 'card_moved' });
      expect(kanbanCards.getById(card.id)).toMatchObject({ activeLaneRunId: null, laneEntryEventId: null });
    });

    it('does not revive a superseded entry while a newer entry is still open', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run1 = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const event1 = run1.laneEntryEventId;

      await moveCard(card.id, lanes[1].id);
      expect(getRun(run1.id).status).toBe('superseded');

      // The newer entry's first dispatch fails, leaving its run open.
      runSession.mockRejectedValueOnce(new Error('provider down'));
      await moveCard(card.id, lanes[0].id);
      const event2 = kanbanCards.getById(card.id).laneEntryEventId;
      expect(event2).not.toBe(event1);
      await vi.waitFor(() => {
        expect(eventRow(event2)).toEqual({ status: 'pending', attempt_count: 1 });
      });
      const run2Id = kanbanCards.getById(card.id).activeLaneRunId;
      expect(getRun(run2Id).status).toBe('open');

      const dispatchesBefore = runSession.mock.calls.length;

      await expect(drainLaneEntryTrigger(event1)).resolves.toBe(false);
      expect(runSession.mock.calls.length).toBe(dispatchesBefore);
      expect(eventRow(event1).status).toBe('invalid');
      expect(kanbanCards.getById(card.id)).toMatchObject({
        activeLaneRunId: run2Id, laneEntryEventId: event2,
      });
      expect(getRun(run2Id).status).toBe('open');
    });
  });

  // ── PR Review issue 10: preserved paused children across restart ──
  // A retry paused mid-setup keeps its child/root for resume. The preserved
  // child must rest in a durable non-executing state so the boot recovery
  // sequence (orphaned-starting + orphaned-running + Kanban preflight) leaves
  // its open obligation alone, and re-enable resumes with the same child
  // exactly once.

  describe('preserved paused child across restart (PR Review issue 10)', () => {
    function runBootRecoverySequence() {
      recoverOrphanedStartingSessions();
      recoverOrphanedRunningSessions();
      reconcileKanbanOwnership({ dryRun: false });
    }

    it('resumes a retry paused during setup after restart with the same starting child', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const { setupGitForSession } = await import('./gitSessionSetup.js');

      // Attempt 1: git-setup failure leaves the attached child in starting
      // with a retryable pending event and no dispatch intent.
      setupGitForSession.mockRejectedValueOnce(new Error('git boom'));
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const childId = getRun(run.id).rootSessionId;
      expect(childId).toBeTruthy();
      expect(sessions.getById(childId).status).toBe('starting');

      // Attempt 2 (retry reuses the child): the lane is disabled during git
      // setup, so the pause preserves the child/root and parks the entry.
      // The outbox retry fires after backoff.
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      const fakeWt = join(tmpdir(), `kanban-paused-restart-wt-${Date.now()}`);
      setupGitForSession.mockImplementationOnce(async () => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return { workingDirectory: fakeWt, gitWorktree: fakeWt };
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

      // The preserved child settles into a durable non-executing state: boot
      // recovery must not mistake it for an orphaned startup.
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', executionState: 'stopped' });
      // One counted attempt (the git failure); the pause itself costs none.
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 1 });
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });

      runBootRecoverySequence();

      // The queued setup survives the restart with its obligation open.
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', ownWorkState: 'open' });
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId).status).toBe('queued');

      // Re-enable dispatches exactly once by reusing the preserved child.
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId).status).toBe('completed');
      });
      expect(runSession).toHaveBeenCalledTimes(1);
      expect(runSession.mock.calls[0][0]).toBe(childId);
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
    });

    it('resumes a retry paused at the provider fence after restart with the same child', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // Retry shape: a prior attempt attached child C1 (pending event, no
      // dispatch intent recorded), and C1 reached the provider fence —
      // prepareRunTurn/beginWorkflowTurn durable writes are visible while no
      // provider execution stands behind them.
      const child = createChildSession(root.id, 'Lane prompt (lane: To Do)');
      attachRootSession(run.id, child.id);
      const childId = child.id;
      databaseManager.get().prepare("UPDATE sessions SET status='running', execution_state='running' WHERE id=?")
        .run(childId);

      // The retry reuses C1: it reaches the provider fence, which rejects on
      // the disable that landed mid-setup. The pause preserves C1 and parks
      // the entry (withdrawing the unacknowledged dispatch intent).
      runSession.mockImplementationOnce(async (retryChildId, prompt, workingDirectory, opts) => {
        expect(retryChildId).toBe(childId);
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        await opts.beforeProviderExecute();
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

      // No visible running child lingers with no provider execution behind it.
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', executionState: 'stopped' });
      const settled = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED && call[2]?.sessionId === childId
      );
      expect(settled.length).toBeGreaterThan(0);
      expect(settled[settled.length - 1][2].session.status).toBe('stopped');
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });

      runBootRecoverySequence();

      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', ownWorkState: 'open' });

      // Re-enable resumes with the same child: one successful dispatch, no
      // duplicate allocation, no exhausted retries.
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId).status).toBe('completed');
      });
      expect(runSession.mock.calls.length).toBe(2);
      expect(runSession.mock.calls[1][0]).toBe(childId);
      expect(sessions.getByProjectId(projectId).filter((s) => s.name.includes('Lane prompt')))
        .toHaveLength(1);
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
    });
  });

  // ── FIFO dispatch order (FR-4, AC-3) ──────────────────────────────

  describe('FIFO dispatch order', () => {
    function restoreTriggerMocks() {
      renderTemplatePrompt.mockReset();
      renderTemplatePrompt.mockResolvedValue('rendered prompt');
      runSession.mockReset();
      runSession.mockResolvedValue(undefined);
    }

    function rootNameForChild(childId) {
      const child = databaseManager.get().prepare('SELECT parent_session_id FROM sessions WHERE id=?').get(childId);
      return sessions.getById(child.parent_session_id).name;
    }

    it('starts drained entries in arrival order with serialized setup', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      const cardA = await addSessionToBoard(createSession('A').id, lanes[0].id);
      const cardB = await addSessionToBoard(createSession('B').id, lanes[0].id);
      const cardC = await addSessionToBoard(createSession('C').id, lanes[0].id);
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });

      const startOrder = [];
      let activeSetups = 0;
      let maxActiveSetups = 0;
      renderTemplatePrompt.mockImplementation(async () => {
        activeSetups += 1;
        maxActiveSetups = Math.max(maxActiveSetups, activeSetups);
        try {
          // A arrives first but resolves setup last; FIFO must still start A first.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'rendered';
        } finally {
          activeSetups -= 1;
        }
      });
      // Only A is slow: later arrivals would otherwise win the dispatch race.
      const baseRender = renderTemplatePrompt.getMockImplementation();
      renderTemplatePrompt.mockImplementation(async (prompt, ctx) => {
        if (ctx?.rootSession?.name !== 'A') return 'rendered fast';
        return baseRender(prompt, ctx);
      });
      runSession.mockImplementation(async (childId) => {
        startOrder.push(rootNameForChild(childId));
        return undefined;
      });
      try {
        drainQueuedEntries(lanes[0].id);
        const db = databaseManager.get();
        await vi.waitFor(() => {
          for (const card of [cardA, cardB, cardC]) {
            expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE card_id=?').get(card.id).status)
              .toBe('completed');
          }
        });
      } finally {
        restoreTriggerMocks();
      }

      expect(startOrder).toEqual(['A', 'B', 'C']);
      expect(maxActiveSetups).toBe(1);
    });

    it('continues past a failed entry and audits the failure', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      const cardA = await addSessionToBoard(createSession('A').id, lanes[0].id);
      const cardB = await addSessionToBoard(createSession('B').id, lanes[0].id);
      const cardC = await addSessionToBoard(createSession('C').id, lanes[0].id);
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });

      runSession.mockImplementation(async (childId) => {
        if (rootNameForChild(childId) === 'B') throw new Error('provider down');
        return undefined;
      });
      try {
        drainQueuedEntries(lanes[0].id);
        const db = databaseManager.get();
        await vi.waitFor(() => {
          expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE card_id=?').get(cardA.id).status)
            .toBe('completed');
          expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE card_id=?').get(cardC.id).status)
            .toBe('completed');
        });
        const runB = db.prepare('SELECT id FROM kanban_lane_runs WHERE card_id=?').get(cardB.id);
        expect(db.prepare("SELECT event_type FROM kanban_lane_run_audit_events WHERE lane_run_id=? AND event_type='delivery_failed'")
          .get(runB.id)?.event_type).toBe('delivery_failed');
      } finally {
        restoreTriggerMocks();
      }
    });
  });

  // ── Provider-boundary pause fence + FIFO slot release (FR-2/FR-4, AC-3/AC-5) ──
  // The per-lane slot must be retained through async provider setup until the
  // actual adapter boundary, and the lane kill-switch re-checked there. These
  // tests drive the drain through a runSession mock that honors the provider
  // boundary contract (fence first, then adapter invocation, then dispatch
  // initiation) — the real runSession path proving the same ordering lives in
  // sessionExecution.providerBoundary.test.js.

  describe('provider-boundary pause fence and FIFO dispatch', () => {
    function rootNameForProviderChild(childId) {
      const child = databaseManager.get().prepare('SELECT parent_session_id FROM sessions WHERE id=?').get(childId);
      return sessions.getById(child.parent_session_id).name;
    }

    function eventStatus(eventId) {
      return databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(eventId);
    }

    function makePromptRun(name) {
      const root = createSession(name);
      const card = kanbanCards.create(lanes[0].id, root.id);
      return createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
    }

    it('parks without adapter invocation when the lane is disabled during provider-setup wait', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const run = makePromptRun('Root');
      const invocations = [];
      runSession.mockImplementation(async (childId, prompt, workingDirectory, opts) => {
        // In-setup wait: model/env resolution and worktree hooks are in flight.
        await new Promise((resolve) => setTimeout(resolve, 30));
        await opts?.beforeProviderExecute?.();
        invocations.push(childId);
        opts?.onProviderDispatchInitiated?.();
        return { started: true };
      });

      const draining = drainLaneEntryTrigger(run.laneEntryEventId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });

      expect(await draining).toBe(false);
      expect(invocations).toEqual([]);
      expect(eventStatus(run.laneEntryEventId)).toEqual({ status: 'queued', attempt_count: 0 });
    });

    it('invokes the adapter in arrival order while the dispatch slot is contended', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const runA = makePromptRun('A');
      const runB = makePromptRun('B');
      const invocationOrder = [];
      runSession.mockImplementation(async (childId, prompt, workingDirectory, opts) => {
        // A arrives first but is slow in setup; B must not overtake it at the
        // adapter boundary while the per-lane slot is held.
        if (rootNameForProviderChild(childId) === 'A') {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        await opts?.beforeProviderExecute?.();
        invocationOrder.push(rootNameForProviderChild(childId));
        opts?.onProviderDispatchInitiated?.();
        return { started: true };
      });

      const [deliveredA, deliveredB] = await Promise.all([
        drainLaneEntryTrigger(runA.laneEntryEventId),
        drainLaneEntryTrigger(runB.laneEntryEventId),
      ]);

      expect(deliveredA).toBe(true);
      expect(deliveredB).toBe(true);
      expect(invocationOrder).toEqual(['A', 'B']);
    });
  });

  // ── Live queue convergence without refetch (FR-3) ────────────────────

  describe('live queue convergence', () => {
    it('publishes an authoritative queue update when a worker parks an entry mid-drain', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      runSession.mockImplementation(async (childId, prompt, workingDirectory, opts) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await opts?.beforeProviderExecute?.();
        return { started: true };
      });
      vi.clearAllMocks();

      const draining = drainLaneEntryTrigger(run.laneEntryEventId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });

      expect(await draining).toBe(false);
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED,
        expect.objectContaining({ cardId: card.id, laneId: lanes[0].id, queueDepth: 1 }),
      );
    });
  });

  // ── Re-enable during pause cleanup (PR Review finding 6) ───────────
  // A disable that lands mid-flight starts async abandonment (worktree
  // removal). A toggle that lands while that cleanup is still pending must
  // settle against the CURRENT lane config once cleanup finishes — resume
  // when re-enabled, no-op when automation was cleared — never strand the
  // entry as queued in an enabled lane.

  describe('re-enable during pause cleanup', () => {
    function claimedEventRow(eventId) {
      return databaseManager.get().prepare(
        'SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?'
      ).get(eventId);
    }

    // Drive a template delivery to the provider boundary, disable there so
    // pause-abandon starts, and hold worktree removal so cleanup stays
    // pending. Returns the in-flight drain promise plus a release function.
    async function startDrainWithHeldCleanup() {
      const template = sessionTemplates.create({
        projectId, name: 'Entry', prompt: 'do something', gitMode: 'worktree', gitBranch: 'lane-feature',
      });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const fakeWt = join(tmpdir(), `kanban-held-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const { setupGitForSession } = await import('./gitSessionSetup.js');
      setupGitForSession.mockImplementationOnce(async () => ({
        workingDirectory: fakeWt, gitWorktree: fakeWt,
      }));
      let releaseRemoval;
      const removalPending = new Promise((resolve) => { releaseRemoval = resolve; });
      gitService.removeWorktree.mockImplementationOnce(() => removalPending);
      runSession.mockImplementationOnce(async (childId, prompt, workingDirectory, opts) => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        await opts.beforeProviderExecute();
        return { started: true };
      });
      const draining = drainLaneEntryTrigger(run.laneEntryEventId);
      // Abandonment is awaiting the held worktree removal.
      await vi.waitFor(() => {
        expect(gitService.removeWorktree).toHaveBeenCalled();
      });
      return { draining, releaseRemoval, root, card, run };
    }

    it('delivers automatically when the lane is re-enabled during pause cleanup', async () => {
      const { draining, releaseRemoval, run } = await startDrainWithHeldCleanup();

      // Re-enable through the REAL toggle operation while cleanup is pending.
      // The entry is still claimed, so this releases nothing yet — same as the
      // PATCH route, which only schedules what the toggle released.
      const toggle = updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: true });
      expect(toggle.eventIds).toEqual([]);
      scheduleLaneEntryDeliveries(toggle.eventIds);

      releaseRemoval();
      expect(await draining).toBe(false);

      // Automatic catch-up with no further PATCH: the woken delivery completes
      // and spawns exactly one replacement child (the abandoned one is gone).
      // The entry is never parked as queued in the enabled lane.
      await vi.waitFor(() => {
        expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId).status).toBe('completed');
      });
      expect(broadcastToProject).not.toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED,
        expect.objectContaining({ laneId: lanes[0].id }),
      );
      // No attempt penalty for the pause: exactly one delivery attempt counted.
      expect(claimedEventRow(run.laneEntryEventId)).toEqual({ status: 'completed', attempt_count: 1 });
      expect(runSession).toHaveBeenCalledTimes(2);
      const names = sessions.getByProjectId(projectId).map((s) => s.name);
      expect(names.filter((name) => name !== 'Root' && name !== 'Test Session')).toHaveLength(1);
    });

    it('consumes the entry as a no-op when automation is cleared during pause cleanup', async () => {
      const { draining, releaseRemoval, card, run } = await startDrainWithHeldCleanup();

      updateLaneWithAutomationToggle(lanes[0].id, {
        onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
      });

      releaseRemoval();
      expect(await draining).toBe(false);
      const db = databaseManager.get();
      expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId).status).toBe('completed');
      expect(db.prepare('SELECT lane_entry_event_id FROM kanban_cards WHERE id=?')
        .get(card.id).lane_entry_event_id).toBeNull();
      // No delivery was ever attempted after the initial disabled fence trip.
      expect(runSession).toHaveBeenCalledTimes(1);
    });

    it('re-enable during pause cleanup preserves FIFO dispatch order (A before B)', async () => {
      const template = sessionTemplates.create({
        projectId, name: 'Entry', prompt: 'do something', gitMode: 'worktree', gitBranch: 'lane-feature',
      });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const rootA = createSession('A');
      const rootB = createSession('B');
      const cardA = kanbanCards.create(lanes[0].id, rootA.id);
      const cardB = kanbanCards.create(lanes[0].id, rootB.id);
      const db = databaseManager.get();
      const runA = createLaneRunForEntry({
        projectId, workspaceId: rootA.id, cardId: cardA.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const runB = createLaneRunForEntry({
        projectId, workspaceId: rootB.id, cardId: cardB.id, lane: kanbanLanes.getById(lanes[0].id),
      });

      const fakeWt = join(tmpdir(), `kanban-fifo-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const { setupGitForSession } = await import('./gitSessionSetup.js');
      setupGitForSession.mockImplementationOnce(async () => ({
        workingDirectory: fakeWt, gitWorktree: fakeWt,
      }));
      let releaseRemoval;
      const removalPending = new Promise((resolve) => { releaseRemoval = resolve; });
      gitService.removeWorktree.mockImplementationOnce(() => removalPending);

      const rootNameForChild = (childId) => {
        const child = db.prepare('SELECT parent_session_id FROM sessions WHERE id=?').get(childId);
        return sessions.getById(child.parent_session_id).name;
      };
      const invocationOrder = [];
      // First provider-boundary call is always A's fence trip: B cannot reach
      // runSession while it waits for A's dispatch slot.
      runSession.mockImplementationOnce(async (childId, prompt, workingDirectory, opts) => {
        expect(rootNameForChild(childId)).toBe('A');
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        await opts.beforeProviderExecute();
        return { started: true };
      });
      const recordDelivery = async (childId, prompt, workingDirectory, opts) => {
        await opts?.beforeProviderExecute?.();
        invocationOrder.push(rootNameForChild(childId));
        opts?.onProviderDispatchInitiated?.();
        return { started: true };
      };
      runSession.mockImplementationOnce(recordDelivery);
      runSession.mockImplementationOnce(recordDelivery);

      // A arrives first and takes the dispatch slot; B arrives second and waits
      // claimed behind it. Both sync prefixes run before either async setup can
      // reach the fence, so the disable always lands mid-flight on A with B
      // already claimed and waiting.
      // Per-call mocks (no persistent implementation): A reaches the fence
      // first while B still waits for the slot, so the first call is always
      // A's fence trip and the next two are the ordered deliveries.
      const drainingA = drainLaneEntryTrigger(runA.laneEntryEventId);
      const drainingB = drainLaneEntryTrigger(runB.laneEntryEventId);
      // A's pause-abandon is awaiting the held worktree removal.
      await vi.waitFor(() => {
        expect(gitService.removeWorktree).toHaveBeenCalled();
      });
      await vi.waitFor(() => {
        expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(runB.laneEntryEventId).status).toBe('claimed');
      });

      // Re-enable through the REAL toggle operation while A's cleanup is still
      // pending. Both entries are claimed, so this releases nothing yet — same
      // as the PATCH route, which only schedules what the toggle released.
      const toggle = updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: true });
      expect(toggle.eventIds).toEqual([]);
      scheduleLaneEntryDeliveries(toggle.eventIds);

      releaseRemoval();
      await Promise.all([drainingA, drainingB]);

      // A keeps its arrival precedence with no further PATCH after the
      // mid-cleanup re-enable: provider invocation order is A then B.
      await vi.waitFor(() => {
        expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(runA.laneEntryEventId).status).toBe('completed');
        expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
          .get(runB.laneEntryEventId).status).toBe('completed');
      });
      expect(invocationOrder).toEqual(['A', 'B']);
      // Exactly one live child per entry: each abandoned undispatched child is gone.
      const childrenOf = (rootId) => sessions.getByProjectId(projectId)
        .filter((session) => session.parentSessionId === rootId);
      expect(childrenOf(rootA.id)).toHaveLength(1);
      expect(childrenOf(rootB.id)).toHaveLength(1);
      // No attempt penalty for the pause.
      expect(db.prepare('SELECT attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(runA.laneEntryEventId).attempt_count).toBe(1);
      expect(db.prepare('SELECT attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(runB.laneEntryEventId).attempt_count).toBe(1);
      // The pause never parks an entry as queued in the enabled lane.
      expect(broadcastToProject).not.toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_ENTRY_QUEUED,
        expect.objectContaining({ laneId: lanes[0].id }),
      );
    });
  });

  // ── Clearing automation with queued entries (FR-1 no-op) ──────────────
  // Configure prompt → disable → queue cards → save Automation = None. The
  // queued intents must resolve as a successful no-op (latest config replays
  // to empty), never as retry-until-fail deliveries.

  describe('clearing automation with queued entries', () => {
    function queueTwoCardsWhilePaused() {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      const db = databaseManager.get();
      const queued = ['A', 'B'].map((name) => {
        const root = createSession(name);
        const card = kanbanCards.create(lanes[0].id, root.id);
        enqueueDisabledEntry(db, {
          projectId, workspaceId: root.id, cardId: card.id,
          lane: kanbanLanes.getById(lanes[0].id), cause: 'card_added',
        });
        return card;
      });
      return { cardA: queued[0], cardB: queued[1] };
    }

    function queuedEvents() {
      return databaseManager.get().prepare(`SELECT id, status FROM kanban_lane_entry_events
        WHERE lane_id=? AND status='queued'`).all(lanes[0].id);
    }

    function deliveryFailedCount() {
      return databaseManager.get().prepare(`SELECT count(*) count FROM kanban_lane_run_audit_events
        WHERE event_type='delivery_failed'`).get().count;
    }

    it('resolves queued entries as a no-op when the re-enable PATCH clears automation', async () => {
      const { cardA, cardB } = queueTwoCardsWhilePaused();
      expect(queuedEvents()).toHaveLength(2);

      const { updated, eventIds } = updateLaneWithAutomationToggle(lanes[0].id, {
        automationEnabled: true, onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
      });

      expect(updated.onEnterPrompt).toBeNull();
      expect(eventIds).toEqual([]);
      const db = databaseManager.get();
      expect(db.prepare(`SELECT count(*) count FROM kanban_lane_entry_events
        WHERE lane_id=? AND status IN ('pending','failed')`).get(lanes[0].id).count).toBe(0);
      for (const card of [cardA, cardB]) {
        expect(db.prepare('SELECT lane_entry_event_id FROM kanban_cards WHERE id=?')
          .get(card.id).lane_entry_event_id).toBeNull();
      }
      expect(deliveryFailedCount()).toBe(0);
      expect(runSession).not.toHaveBeenCalled();
    });

    it('resolves queued entries as a no-op when automation is cleared while paused, then re-enabled', async () => {
      const { cardA, cardB } = queueTwoCardsWhilePaused();

      updateLaneWithAutomationToggle(lanes[0].id, {
        onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
      });
      expect(queuedEvents()).toHaveLength(0);

      const reenabled = updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: true });
      expect(reenabled.eventIds).toEqual([]);

      const db = databaseManager.get();
      expect(db.prepare(`SELECT count(*) count FROM kanban_lane_entry_events
        WHERE lane_id=? AND status IN ('pending','failed')`).get(lanes[0].id).count).toBe(0);
      for (const card of [cardA, cardB]) {
        expect(db.prepare('SELECT lane_entry_event_id FROM kanban_cards WHERE id=?')
          .get(card.id).lane_entry_event_id).toBeNull();
      }
      expect(deliveryFailedCount()).toBe(0);
      expect(runSession).not.toHaveBeenCalled();
    });

    it('resolves an in-flight pending entry as a no-op after automation is cleared', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null });

      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(true);

      const db = databaseManager.get();
      expect(db.prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId).status).toBe('completed');
      expect(db.prepare('SELECT lane_entry_event_id FROM kanban_cards WHERE id=?')
        .get(card.id).lane_entry_event_id).toBeNull();
      expect(deliveryFailedCount()).toBe(0);
      expect(runSession).not.toHaveBeenCalled();
    });
  });

  // ── moveCard ───────────────────────────────────────────────────────

  describe('moveCard', () => {
    it('rolls back supersession and card movement when durable lane-entry intent cannot be recorded', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[1].id, { onEnterTemplateId: template.id });
      const db = databaseManager.get();
      db.exec(`CREATE TRIGGER fail_lane_entry_event_insert BEFORE INSERT ON kanban_lane_entry_events
        BEGIN SELECT injected_lane_entry_event_failure(); END;`);

      try {
        await expect(moveCard(card.id, lanes[1].id)).rejects.toThrow('no such function: injected_lane_entry_event_failure');
        expect(kanbanCards.getById(card.id).laneId).toBe(lanes[0].id);
      } finally {
        db.exec('DROP TRIGGER IF EXISTS fail_lane_entry_event_insert');
      }
    });

    it('moves a card to a different lane', async () => {
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);
      vi.clearAllMocks();

      const moved = await moveCard(card.id, lanes[1].id);

      expect(moved).not.toBeNull();
      const cardsInOldLane = kanbanCards.getByLaneId(lanes[0].id);
      const cardsInNewLane = kanbanCards.getByLaneId(lanes[1].id);
      expect(cardsInOldLane).toHaveLength(0);
      expect(cardsInNewLane).toHaveLength(1);
    });

    it('broadcasts KANBAN_CARD_MOVED', async () => {
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);
      vi.clearAllMocks();

      await moveCard(card.id, lanes[1].id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_MOVED,
        expect.objectContaining({
          projectId,
          cardId: card.id,
          fromLaneId: lanes[0].id,
          toLaneId: lanes[1].id,
        })
      );
    });

    it('throws when card does not exist', async () => {
      await expect(moveCard('non-existent', lanes[0].id)).rejects.toThrow('Card not found');
    });

    it('cancels a lane worker\'s workflow standing without aborting its in-flight turn', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: session.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'review', completionTargetLaneId: lanes[2].id },
      });
      const worker = sessions.create(projectId, 'Worker', 'lane work', { parentSessionId: session.id });
      attachRootSession(run.id, worker.id);
      databaseManager.get().prepare("UPDATE sessions SET status='running' WHERE id=?").run(worker.id);

      await moveCard(card.id, lanes[1].id);

      // The worker's own-work obligation is cancelled, but its turn is left
      // running — supersession stops granting workflow authority, it does not
      // terminate execution.
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
      expect(sessions.getById(worker.id)).toEqual(expect.objectContaining({
        // This fixture has not started a provider turn, so its pre-existing
        // idle lifecycle is preserved rather than falsely claiming stopped.
        status: 'running', executionState: 'idle',
      }));
      expect(getRun(run.id)).toEqual(expect.objectContaining({ status: 'superseded', failureReason: 'card_moved' }));
    });

    it('skips on-enter template when runOnEnterTemplate is false', async () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Auto Template',
        prompt: 'Do something',
      });

      kanbanLanes.update(lanes[1].id, { onEnterTemplateId: template.id });

      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);
      vi.clearAllMocks();

      await moveCard(card.id, lanes[1].id, { runOnEnterTemplate: false });

      // Should broadcast the move but not create a new session
      expect(broadcastToProject).toHaveBeenCalledTimes(1);
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_MOVED,
        expect.anything()
      );
      expect(databaseManager.get().prepare('SELECT count(*) AS count FROM kanban_lane_runs').get().count).toBe(0);
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
    });
  });

  // ── lane entry does NOT trigger completion move ────────────────────
  //
  // The completion target only advances a card when a turn actually
  // completes *while parked in the lane* (handled on turn completion).
  // Merely placing or moving a card into a lane must NOT advance it, even
  // if the session happens to be in `waiting` — `waiting` means "ready for
  // follow-up", not "finished work in this lane", and auto-jumping would
  // make it impossible to drop a completed card into a lane and have it
  // stay there.

  describe('lane entry does not trigger completion move', () => {
    it('does not advance a waiting session when added to a completion-target lane', async () => {
      const session = createSession();
      sessions.update(session.id, { status: 'waiting' });
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', completionTargetLaneId: lanes[1].id });

      await addSessionToBoard(session.id, lanes[0].id);

      const card = kanbanCards.getBySessionId(session.id);
      expect(card.laneId).toBe(lanes[0].id);
    });

    it('does not advance a waiting session when moved into a completion-target lane', async () => {
      const session = createSession();
      const card = await addSessionToBoard(session.id, lanes[0].id);
      sessions.update(session.id, { status: 'waiting' });
      kanbanLanes.update(lanes[2].id, { onEnterPrompt: 'Do the work', completionTargetLaneId: lanes[3].id });

      await moveCard(card.id, lanes[2].id);

      const finalCard = kanbanCards.getBySessionId(session.id);
      expect(finalCard.laneId).toBe(lanes[2].id);
    });
  });

  // ── removeSessionFromBoard ─────────────────────────────────────────

  describe('removeSessionFromBoard', () => {
    it('removes card when session is on the board', () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      removeSessionFromBoard(session.id);

      expect(kanbanCards.getById(card.id)).toBeNull();
    });

    it('broadcasts KANBAN_CARD_REMOVED', () => {
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      vi.clearAllMocks();

      removeSessionFromBoard(session.id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
        expect.objectContaining({
          projectId,
          laneId: lanes[0].id,
        })
      );
    });

    it('does nothing when session is not on the board', () => {
      const session = createSession();
      removeSessionFromBoard(session.id);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('removes the workspace card when called with a child session id', () => {
      const root = createSession('Root');
      const child = createChildSession(root.id);
      const card = kanbanCards.create(lanes[0].id, root.id);

      removeSessionFromBoard(child.id);

      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
        expect.objectContaining({ cardId: card.id })
      );
    });

    it('returns null when the workspace has no card', () => {
      const session = createSession();
      expect(removeSessionFromBoard(session.id)).toBeNull();
    });

    it('cannot find the card once the session row is gone — callers must retire first', () => {
      // The join row cascades with the session, so the card is unreachable by
      // session id after deletion. This pins the ordering contract the
      // session-delete route relies on: removeSessionFromBoard BEFORE the
      // session cascade, not after.
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      sessions.delete(session.id);
      vi.clearAllMocks();

      expect(removeSessionFromBoard(session.id)).toBeNull();
      expect(kanbanCards.getById(card.id)).not.toBeNull();
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  // ── removeCard / removeLane / removeBoard ─────────────────────────

  describe('removeCard', () => {
    it('deletes a legacy card with no active run and broadcasts', () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      vi.clearAllMocks();

      const result = removeCard(card);

      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(result).toEqual({ projectId, laneId: lanes[0].id });
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
        expect.objectContaining({ cardId: card.id })
      );
    });

    it('derives the project from the card when its sessions are already deleted', () => {
      // Cards fetched by lane (bulk removal) outlive their session rows;
      // the broadcast project must come from card → lane → board.
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      sessions.delete(session.id);
      const card = kanbanCards.getByLaneId(lanes[0].id)[0];
      vi.clearAllMocks();

      const result = removeCard(card);

      expect(result).toEqual({ projectId, laneId: lanes[0].id });
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
        expect.objectContaining({ cardId: card.id, projectId })
      );
    });

    it('rolls back both the supersession and the delete when the transaction fails', () => {
      const { card, run } = setupActiveLaneRunCard();
      // Force the card delete itself to blow up mid-transaction.
      const deleteSpy = vi.spyOn(kanbanCards, 'delete')
        .mockImplementationOnce(() => { throw new Error('boom'); });
      try {
        expect(() => removeCard(kanbanCards.getById(card.id))).toThrow('boom');
      } finally {
        deleteSpy.mockRestore();
      }

      // Nothing committed: run still open, card still present and owned.
      expect(getRun(run.id).status).toBe('open');
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBe(run.id);
    });
  });

  describe('removeLane', () => {
    it('deletes the lane, its cards, and supersedes their runs in one commit', () => {
      const { card, run } = setupActiveLaneRunCard();
      vi.clearAllMocks();

      removeLane(lanes[0]);

      expect(kanbanLanes.getById(lanes[0].id)).toBeNull();
      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
      // Bulk removal is one board-level change; no per-card events.
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  describe('removeBoard', () => {
    it('deletes the board, its lanes, and its cards, superseding runs', () => {
      const { card, run } = setupActiveLaneRunCard();
      const board = kanbanBoards.getByProjectId(projectId);
      vi.clearAllMocks();

      removeBoard(board);

      expect(kanbanBoards.getByProjectId(projectId)).toBeNull();
      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  describe('removeBoardForProject', () => {
    it('supersedes runs and removes the board when one exists', () => {
      const { card, run } = setupActiveLaneRunCard();
      vi.clearAllMocks();

      removeBoardForProject(projectId);

      expect(kanbanBoards.getByProjectId(projectId)).toBeNull();
      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
    });

    it('is a no-op when the project has no board', () => {
      expect(() => removeBoardForProject('no-such-project')).not.toThrow();
    });
  });

  // ── Queued entry deletion cleanup (FR-3) ───────────────────────────

  describe('queued entry deletion cleanup', () => {
    function entryCount() {
      return databaseManager.get().prepare('SELECT COUNT(*) AS count FROM kanban_lane_entry_events').get().count;
    }

    it('removeCard removes the queued entry', async () => {
      const session = createSession();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      const card = await addSessionToBoard(session.id, lanes[0].id);
      expect(entryCount()).toBe(1);

      removeCard(kanbanCards.getById(card.id));

      expect(entryCount()).toBe(0);
      expect(getFullBoard(projectId).lanes.find((l) => l.id === lanes[0].id).queuedCount).toBe(0);
    });

    it('removeLane removes queued entries of its lanes', async () => {
      const session = createSession();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      await addSessionToBoard(session.id, lanes[0].id);
      expect(entryCount()).toBe(1);

      removeLane(lanes[0]);

      expect(entryCount()).toBe(0);
    });

    it('removeBoard removes queued entries of the whole board', async () => {
      const session = createSession();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      await addSessionToBoard(session.id, lanes[0].id);
      expect(entryCount()).toBe(1);

      removeBoard(kanbanBoards.getByProjectId(projectId));

      expect(entryCount()).toBe(0);
    });

    it('removeBoardForProject removes queued entries with the project board', async () => {
      const session = createSession();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      await addSessionToBoard(session.id, lanes[0].id);
      expect(entryCount()).toBe(1);

      removeBoardForProject(projectId);

      expect(entryCount()).toBe(0);
    });

    it('removeSessionFromBoard removes the queued entry with the card', async () => {
      const session = createSession();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something', automationEnabled: false });
      await addSessionToBoard(session.id, lanes[0].id);
      expect(entryCount()).toBe(1);

      removeSessionFromBoard(session.id);

      expect(entryCount()).toBe(0);
    });
  });

  // ── Lane agent settings ────────────────────────────────────────────

  describe('lane agent settings in triggerOnEnterPrompt', () => {
    it('lane-level settings override parent session settings', async () => {
      // Create parent session with default settings
      const session = sessions.create(projectId, 'Parent Session', 'Prompt', {
        mode: 'standard',
        thinkingEnabled: false,
        model: null,
      });
      const card = kanbanCards.create(lanes[0].id, session.id);

      // Configure lane 1 with agent settings
      databaseManager.get().prepare(`UPDATE kanban_lanes SET on_enter_prompt=?, on_enter_mode=?,
        on_enter_model=?, on_enter_effort_level=?, on_enter_thinking_enabled=1 WHERE id=?`)
        .run('do something', 'plan', 'claude-sonnet-4-20250514', 'high', lanes[1].id);

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Find the newly created child session
      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);

      expect(childSession).toBeDefined();
      expect(childSession.mode).toBe('plan');
      expect(childSession.model).toBe('claude-sonnet-4-20250514');
      expect(childSession.effortLevel).toBe('high');
      expect(childSession.thinkingEnabled).toBe(true);
    });

    it('lane settings fall back to parent when null', async () => {
      // Create parent session with specific settings
      const session = sessions.create(projectId, 'Parent Session', 'Prompt', {
        mode: 'yolo',
        thinkingEnabled: true,
        model: 'claude-sonnet-4-20250514',
      });
      const card = kanbanCards.create(lanes[0].id, session.id);

      // Configure lane 1 with just a prompt, no agent settings override
      kanbanLanes.update(lanes[1].id, {
        onEnterPrompt: 'do something',
        onEnterMode: null,
        onEnterModel: null,
        onEnterEffortLevel: null,
        onEnterThinkingEnabled: null,
      });

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Find the newly created child session
      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);

      expect(childSession).toBeDefined();
      expect(childSession.mode).toBe('yolo');
      expect(childSession.thinkingEnabled).toBe(true);
      expect(childSession.model).toBe('claude-sonnet-4-20250514');
    });

    it('auto-reschedule settings are applied to child session', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      // Configure lane with auto-reschedule settings
      kanbanLanes.update(lanes[1].id, {
        onEnterPrompt: 'do something',
        onEnterAutoRescheduleEnabled: true,
        onEnterRescheduleDelayMinutes: 30,
        onEnterRescheduleOnTokenLimit: true,
        onEnterRescheduleOnServiceError: false,
        onEnterMaxRescheduleCount: 5,
      });

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Find the newly created child session
      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);

      expect(childSession).toBeDefined();
      expect(childSession.autoRescheduleEnabled).toBe(true);
      expect(childSession.rescheduleDelayMinutes).toBe(30);
      expect(childSession.rescheduleOnTokenLimit).toBe(true);
      expect(childSession.rescheduleOnServiceError).toBe(false);
      expect(childSession.maxRescheduleCount).toBe(5);
    });

    it('effort level is properly passed via options-object form', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      // Configure lane with effort level override
      kanbanLanes.update(lanes[1].id, {
        onEnterPrompt: 'do something',
        onEnterEffortLevel: 'max',
      });

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Find the newly created child session
      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);

      expect(childSession).toBeDefined();
      expect(childSession.effortLevel).toBe('max');
    });

    it('runSession is called with options-object form', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      databaseManager.get().prepare('UPDATE kanban_lanes SET on_enter_prompt=?, on_enter_model=? WHERE id=?')
        .run('do something', 'claude-sonnet-4-20250514', lanes[1].id);

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Verify runSession was called with options object (4 args), not positional args
      expect(runSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        })
      );
    });

    it('runSession in triggerOnEnterTemplate is called with options-object form', async () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Auto Template',
        prompt: 'Do something from template',
        model: 'claude-opus-4-20250514',
      });

      databaseManager.get().prepare('UPDATE kanban_lanes SET on_enter_template_id=? WHERE id=?')
        .run(template.id, lanes[1].id);

      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // Ensure it was NOT called with 6 args (the old positional form)
      // runSession should be called with 4 args where 4th is an options object
      const callArgs = runSession.mock.calls[0];
      expect(callArgs.length).toBe(4);
      expect(typeof callArgs[3]).toBe('object');
      // systemPrompt and model should be present as keys (even if null)
      expect(Object.keys(callArgs[3])).toContain('systemPrompt');
    });

    it('agent settings are not applied when lane uses template automation', async () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Template',
        prompt: 'Do template work',
      });

      // Set template on lane (no prompt automation)
      kanbanLanes.update(lanes[1].id, { onEnterTemplateId: template.id });

      const session = createSession('Parent');
      const card = kanbanCards.create(lanes[0].id, session.id);

      vi.clearAllMocks();
      await moveCard(card.id, lanes[1].id);

      // A child session was created via template trigger
      const allSessions = sessions.getByProjectId(projectId);
      const childSession = allSessions.find((s) => s.id !== session.id);
      expect(childSession).toBeDefined();

      // Child session should exist (template-triggered), not crash
      expect(childSession.status).toBeDefined();
    });
  });

  // ── triggerStructuredTransitionAutomation (W6) ────────────────────────

  describe('triggerStructuredTransitionAutomation', () => {
    it('starts the target lane on-enter prompt exactly once and links the new run to the source run', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[0].id, workspace.id);
      const sourceRun = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id,
        lane: { ...lanes[0], onEnterPrompt: 'source work' },
      });
      databaseManager.get().prepare(`UPDATE kanban_lane_runs
        SET status='succeeded', transition_applied_at=?, succeeded_at=? WHERE id=?`)
        .run(Date.now(), Date.now(), sourceRun.id);
      kanbanCards.moveToLane(card.id, lanes[1].id);
      const targetLane = kanbanLanes.getById(lanes[1].id);
      const targetRun = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: targetLane,
        cause: 'completion', priorLaneRunId: sourceRun.id,
      });

      await triggerStructuredTransitionAutomation({
        workspaceSessionId: workspace.id,
        targetLaneId: lanes[1].id,
        cardId: card.id,
        sourceRunId: sourceRun.id,
        laneEntryEventId: targetRun.laneEntryEventId,
      });

      expect(runSession).toHaveBeenCalledTimes(1);
      const newSessions = sessions.getByProjectId(projectId).filter((s) => s.id !== workspace.id);
      expect(newSessions).toHaveLength(1);
      expect(newSessions[0].laneRunId).toBeTruthy();

      const newRun = databaseManager.get().prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(newSessions[0].laneRunId);
      expect(newRun.prior_lane_run_id).toBe(sourceRun.id);
      expect(newRun.source_lane_id).toBe(lanes[1].id);
    });

    it('rejects a completion descriptor that has no atomically-created target run', async () => {
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[0].id, workspace.id);

      await expect(triggerStructuredTransitionAutomation({
        workspaceSessionId: workspace.id,
        targetLaneId: lanes[1].id, // no onEnterPrompt/onEnterTemplateId — not structured
        cardId: card.id,
        sourceRunId: 'source-run-1',
      })).rejects.toThrow('Target lane run is missing');

      expect(runSession).not.toHaveBeenCalled();
      expect(sessions.getByProjectId(projectId)).toHaveLength(1);
    });

    it('is a no-op when the workspace session no longer exists', async () => {
      await expect(triggerStructuredTransitionAutomation({
        workspaceSessionId: 'deleted-session',
        targetLaneId: lanes[1].id,
        cardId: 'irrelevant-card',
        sourceRunId: 'source-run-1',
      })).resolves.toBeUndefined();
      expect(runSession).not.toHaveBeenCalled();
    });
  });

  describe('durable completion outbox', () => {
    it('acknowledges lane entry after its delivered worker selects a deferred route and completes', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Process this card' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[0].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      runSession.mockImplementationOnce(async (workerId) => {
        const { turnToken } = beginWorkflowTurn(workerId);
        const response = await routeWorkspaceCard(workspace.id, lanes[1].id);
        expect(response).toMatchObject({ status: 'scheduled', laneId: lanes[1].id });
        expect(kanbanCards.getById(card.id).laneId).toBe(lanes[0].id);
        finalizeOwnWorkCompletion(workerId, { turnToken });
        return { started: true };
      });

      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(true);

      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(getRun(run.id).status).toBe('succeeded');
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId).status).toBe('completed');
    });

    it('reclaims a claim at its exact expiry, not five minutes later', () => {
      const expiry = Date.now();
      databaseManager.get().prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,status,claim_token,claimed_at,claim_expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'claimed',?,?,?,?,?)`)
        .run('exact-expiry-event', 'exact-expiry-key', projectId, 'workspace', 'card', lanes[0].id,
          'card_added', 'claim', expiry - 1, expiry, expiry - 1, expiry - 1);

      expect(reclaimExpiredLaneEntryClaims(expiry - 1)).toBe(0);
      expect(reclaimExpiredLaneEntryClaims(expiry)).toBe(1);
      expect(databaseManager.get().prepare('SELECT status, claim_token FROM kanban_lane_entry_events WHERE id=?')
        .get('exact-expiry-event')).toEqual({ status: 'pending', claim_token: null });
    });

    it('preserves and resumes a valid rootless target run after restart reconciliation', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const sourceRunId = 'source-run-recovery';
      const eventId = 'completion-recovery-event';
      const time = Date.now();
      databaseManager.get().prepare(`INSERT INTO kanban_lane_runs
        (id,lane_entry_event_id,project_id,workspace_id,card_id,source_lane_id,status,created_at,updated_at,succeeded_at,transition_applied_at)
        VALUES (?,?,?,?,?,?,'succeeded',?,?,?,?)`)
        .run(sourceRunId, 'source-entry-event-recovery', projectId, workspace.id, card.id, lanes[0].id,
          time, time, time, time);
      databaseManager.get().prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`)
        .run(eventId, `completion:${sourceRunId}`, projectId, workspace.id, card.id, lanes[1].id,
          'completion', sourceRunId, time, time);

      const rootlessTargetRun = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id,
        lane: kanbanLanes.getById(lanes[1].id), cause: 'completion',
        priorLaneRunId: sourceRunId, entryEventId: eventId,
      });
      expect(rootlessTargetRun.rootSessionId).toBeNull();

      // Simulate a process dying after it claimed delivery and created the
      // target run, but before it could attach the new root session.
      databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
        SET claim_token='abandoned-process', claimed_at=?, attempt_count=1 WHERE id=?`)
        .run(Date.now(), eventId);

      const recovery = reconcileKanbanOwnership({ dryRun: false });
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(rootlessTargetRun.id).status).toBe('open');
      expect(databaseManager.get().prepare('SELECT claim_token FROM kanban_lane_entry_events WHERE id=?').get(eventId).claim_token).toBeNull();
      expect(recovery.report.ok).toBe(true);

      expect(await drainLaneEntryTrigger(eventId)).toBe(true);
      const resumed = databaseManager.get().prepare('SELECT * FROM kanban_lane_runs WHERE id=?').get(rootlessTargetRun.id);
      expect(resumed).toEqual(expect.objectContaining({ status: 'open', root_session_id: expect.any(String) }));
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?').get(eventId).status).toBe('completed');
      expect(await drainLaneEntryTrigger(eventId)).toBe(false);
      expect(databaseManager.get().prepare('SELECT count(*) count FROM kanban_lane_runs WHERE lane_entry_event_id=?').get(eventId).count).toBe(1);
      expect(runSession).toHaveBeenCalledTimes(1);
    });

    it('reuses an attached child when retrying a failure before dispatch intent', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue safely' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const eventId = 'pre-intent-retry-event';
      const time = Date.now();
      databaseManager.get().prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending',?,?)`)
        .run(eventId, eventId, projectId, workspace.id, card.id, lanes[1].id, 'card_moved', time, time);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id,
        lane: kanbanLanes.getById(lanes[1].id), entryEventId: eventId,
      });
      const child = createChildSession(workspace.id, 'Allocated child');
      databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=? WHERE id=?')
        .run(child.id, run.id);
      databaseManager.get().prepare('UPDATE sessions SET lane_run_id=? WHERE id=?').run(run.id, child.id);

      expect(await drainLaneEntryTrigger(eventId)).toBe(true);

      expect(sessions.getByProjectId(projectId).filter((item) => item.id !== workspace.id)).toHaveLength(1);
      expect(runSession).toHaveBeenCalledTimes(1);
      expect(databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key
        FROM kanban_lane_entry_events WHERE id=?`).get(eventId)).toEqual({
        status: 'completed', delivery_phase: 'completed', dispatch_key: expect.any(String),
      });
    });

    it('drains a pending completion event once and marks it completed', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      // The card must already be in the event's target lane: an entry event
      // represents a transition that already committed synchronously, with
      // only the async on-enter automation trigger left to drain
      // (drainLaneEntryTrigger revalidates card.lane_id === event.lane_id).
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const eventId = 'pending-completion-event';
      // Completion outbox delivery is owned by a real, committed source
      // transition. A stale/superseded source is intentionally rejected.
      databaseManager.get().prepare(`INSERT INTO kanban_lane_runs
        (id,lane_entry_event_id,project_id,workspace_id,card_id,source_lane_id,status,created_at,updated_at,succeeded_at,transition_applied_at)
        VALUES (?,?,?,?,?,?,'succeeded',?,?,?,?)`)
        .run('source-run-1', 'source-entry-event', projectId, workspace.id, card.id, lanes[0].id,
          Date.now(), Date.now(), Date.now(), Date.now());
      databaseManager.get().prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,caused_by_run_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,? ,?,'pending',?,?)`)
        .run(eventId, 'completion:source-run-1', projectId, workspace.id, card.id, lanes[1].id, 'completion', 'source-run-1', Date.now(), Date.now());

      expect(await drainLaneEntryTrigger(eventId)).toBe(true);
      expect(await drainLaneEntryTrigger(eventId)).toBe(false);
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?').get(eventId).status).toBe('completed');
      expect(runSession).toHaveBeenCalledTimes(1);
    });
  });
});
