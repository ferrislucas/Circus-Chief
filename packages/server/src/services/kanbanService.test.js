import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
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
  // The default stands in for a genuinely executed turn: real adapters
  // signal provider acceptance before completing, so the mock fires
  // onProviderAccepted first. Tests for missing acceptance override this.
  // An undefined resolution is NOT acceptance in the durable delivery path.
  runSession: vi.fn().mockImplementation((_id, _prompt, _dir, options) => {
    options?.onProviderAccepted?.({ boundary: 'test-acceptance' });
    return Promise.resolve({ started: true });
  }),
}));

vi.mock('./sessionProvider.js', () => ({
  resolveAgentTypeFromModel: vi.fn().mockReturnValue('codex'),
  resolveProviderMetadataFromModel: vi.fn().mockReturnValue({
    kind: 'openai', authToken: 'test-key', commitAttributionOverride: null,
    supportsIdempotentDispatch: true,
  }),
}));

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  sessionTemplates,
  databaseManager,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
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
  drainLaneEntryTrigger,
  drainPendingLaneEntryTriggers,
  reclaimExpiredLaneEntryClaims,
} from './kanbanService.js';
import {
  beginWorkflowTurn, claimWorkflowSessionStart, createLaneRunForEntry, attachRootSession,
  finalizeOwnWorkCompletion, getRun, attemptLaneRunTransition,
} from './workflowSessionService.js';
import { reconcileKanbanOwnership, getLaneEntryRecoveryCandidates } from './kanbanRecoveryService.js';
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
        // A generic rejection proves nothing about provider start: the
        // uncertainty is parked for reconciliation, never auto-replayed.
        expect(event.status).toBe('needs_attention');
        // The original provider rejection is retained in diagnostics.
        expect(event.last_error).toContain('provider unavailable');
      });
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
      runSession.mockImplementationOnce(async (workerId, _prompt, _dir, options) => {
        // The real adapter signals provider acceptance when the turn starts;
        // without it the durable path must not complete delivery.
        options?.onProviderAccepted?.({ boundary: 'test-acceptance' });
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

    it('parks an unaccepted completion without replaying the provider', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      // A turn that finishes `{ started: true }` WITHOUT an acceptance
      // signal (reschedule, user stop, error-result stream) proves nothing.
      runSession.mockImplementationOnce(() => Promise.resolve({ started: true }));

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Lane-entry delivery failed');
      const event = databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key,
        attempt_count, last_error FROM kanban_lane_entry_events WHERE id=?`).get(run.laneEntryEventId);
      // Intent and key survive for reconciliation; the failure is parked.
      expect(event).toMatchObject({ status: 'needs_attention', delivery_phase: 'dispatch_intent', attempt_count: 1 });
      expect(event.dispatch_key).toEqual(expect.any(String));
      expect(event.last_error).toMatch(/^ambiguous_dispatch: /);
      expect(runSession).toHaveBeenCalledTimes(1);

      // Repeated drains and the retry poller must not call the provider
      // again and must not burn attempts on the parked uncertainty.
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
      await drainPendingLaneEntryTriggers();
      expect(runSession).toHaveBeenCalledTimes(1);
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'needs_attention', attempt_count: 1 });
    });

    it('retries a definitive pre-start rejection under the owning claim', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      runSession.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' });
      });

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      const event = databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key,
        attempt_count, next_attempt_at, last_error FROM kanban_lane_entry_events WHERE id=?`)
        .get(run.laneEntryEventId);
      // The unproven intent is cleared under the owner so the retry stays
      // retryable; backoff applies and the original reason is retained.
      expect(event).toMatchObject({ status: 'pending', delivery_phase: 'pending', attempt_count: 1 });
      expect(event.dispatch_key).toBeNull();
      expect(event.next_attempt_at).toBeGreaterThan(Date.now());
      expect(event.last_error).toContain('Codex CLI not found');
    });

    it('revives failed work once per eligible retry, never for open work', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      // The failed turn closed its run and obligation before reporting the
      // definitive pre-start error.
      const failTime = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_runs SET status='failed', failure_reason='setup failed',
        failed_at=? WHERE id=?`).run(failTime, run.id);
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_failed' WHERE id=?`).run(child.id);
      const failingSpawn = async () => {
        throw Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' });
      };
      runSession.mockImplementationOnce(failingSpawn);

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(run.id))
        .toEqual({ status: 'open' });
      expect(databaseManager.get().prepare('SELECT own_work_state FROM sessions WHERE id=?').get(child.id))
        .toEqual({ own_work_state: 'open' });
      // Revival is audited (the audit row is idempotent per run+child, so
      // repeat revives are proven by state, not by audit count).
      expect(databaseManager.get().prepare(`SELECT count(*) count FROM kanban_lane_run_audit_events
        WHERE lane_run_id=? AND event_type='run_revived_for_retry'`).get(run.id).count).toBe(1);

      // A second eligible retry revives again: the failure markers the
      // revival clears are gone afterwards.
      databaseManager.get().prepare('UPDATE kanban_lane_runs SET status=?, failure_reason=?, failed_at=? WHERE id=?')
        .run('failed', 'second failure', Date.now(), run.id);
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_failed' WHERE id=?`).run(child.id);
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      runSession.mockImplementationOnce(failingSpawn);
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      expect(databaseManager.get().prepare('SELECT status, failure_reason, failed_at FROM kanban_lane_runs WHERE id=?')
        .get(run.id)).toEqual({ status: 'open', failure_reason: null, failed_at: null });
      expect(databaseManager.get().prepare('SELECT own_work_state FROM sessions WHERE id=?').get(child.id))
        .toEqual({ own_work_state: 'open' });
      // And a retry against already-open work performs no revival at all:
      // leftover markers survive the attempt untouched.
      databaseManager.get().prepare(`UPDATE kanban_lane_runs SET failure_reason='leftover' WHERE id=?`).run(run.id);
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      runSession.mockImplementationOnce(failingSpawn);
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      expect(databaseManager.get().prepare('SELECT status, failure_reason FROM kanban_lane_runs WHERE id=?')
        .get(run.id)).toEqual({ status: 'open', failure_reason: 'leftover' });
    });

    it('a stale worker that lost its claim revives nothing', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      const failTime = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_runs SET status='failed', failure_reason='setup failed',
        failed_at=? WHERE id=?`).run(failTime, run.id);
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_failed' WHERE id=?`).run(child.id);
      runSession.mockImplementationOnce(async () => {
        const db = databaseManager.get();
        // Simulate the poller-first ordering: the poller reclaims the
        // expired lease, parks the event, and a replacement takes over the
        // card before the original worker reports its failure.
        const target = db.prepare('SELECT dispatch_key FROM kanban_lane_entry_events WHERE id=?')
          .get(run.laneEntryEventId);
        db.prepare(`UPDATE kanban_lane_entry_events SET status='needs_attention',
          last_error='ambiguous_dispatch: poller parked first', updated_at=?,
          claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL WHERE id=?`)
          .run(Date.now(), run.laneEntryEventId);
        expect(target.dispatch_key).toEqual(expect.any(String));
        throw Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' });
      });

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      // The refused reset revives nothing: the failed run and obligation
      // stay failed, and the parked intent is untouched.
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(run.id))
        .toEqual({ status: 'failed' });
      expect(databaseManager.get().prepare('SELECT own_work_state FROM sessions WHERE id=?').get(child.id))
        .toEqual({ own_work_state: 'closed_failed' });
      expect(databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key, last_error
        FROM kanban_lane_entry_events WHERE id=?`).get(run.laneEntryEventId)).toMatchObject({
        status: 'needs_attention', delivery_phase: 'dispatch_intent', last_error: 'ambiguous_dispatch: poller parked first',
      });
      expect(databaseManager.get().prepare(`SELECT count(*) count FROM kanban_lane_run_audit_events
        WHERE lane_run_id=? AND event_type='run_revived_for_retry'`).get(run.id).count).toBe(0);
    });

    it('a stale worker never touches a terminal event', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      const failTime = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_runs SET status='failed', failure_reason='setup failed',
        failed_at=? WHERE id=?`).run(failTime, run.id);
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_failed' WHERE id=?`).run(child.id);
      runSession.mockImplementationOnce(async () => {
        // A racing path terminally fails the event while this worker's
        // dispatch is still in flight.
        databaseManager.get().prepare(`UPDATE kanban_lane_entry_events SET status='failed',
          last_error='delivery attempts exhausted', completed_at=?, updated_at=?, claim_token=NULL,
          claimed_at=NULL, claim_expires_at=NULL WHERE id=?`)
          .run(Date.now(), Date.now(), run.laneEntryEventId);
        throw Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' });
      });

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      // Terminal state is retained verbatim: no revival, no error rewrite.
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(run.id))
        .toEqual({ status: 'failed' });
      expect(databaseManager.get().prepare('SELECT own_work_state FROM sessions WHERE id=?').get(child.id))
        .toEqual({ own_work_state: 'closed_failed' });
      expect(databaseManager.get().prepare('SELECT status, last_error FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'failed', last_error: 'delivery attempts exhausted' });
    });

    it('a stale worker never revives work the card has moved past', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      const failTime = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_runs SET status='failed', failure_reason='setup failed',
        failed_at=? WHERE id=?`).run(failTime, run.id);
      databaseManager.get().prepare(`UPDATE sessions SET own_work_state='closed_failed' WHERE id=?`).run(child.id);
      let replacement;
      runSession.mockImplementationOnce(async () => {
        // The card moves on to a replacement entry/run while this worker's
        // dispatch is still in flight. Its own claim is still live.
        replacement = createLaneRunForEntry({
          projectId, workspaceId: workspace.id, cardId: card.id,
          lane: kanbanLanes.getById(lanes[1].id), cause: 'manual_move',
        });
        throw Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' });
      });

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('Codex CLI not found');
      // The stale delivery revives nothing: its run stays failed and the
      // replacement's state is untouched.
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(run.id))
        .toEqual({ status: 'failed' });
      expect(databaseManager.get().prepare('SELECT own_work_state FROM sessions WHERE id=?').get(child.id))
        .toEqual({ own_work_state: 'closed_failed' });
      expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(replacement.id))
        .toEqual({ status: 'open' });
      expect(databaseManager.get().prepare('SELECT active_lane_run_id, lane_entry_event_id FROM kanban_cards WHERE id=?')
        .get(card.id)).toEqual({ active_lane_run_id: replacement.id, lane_entry_event_id: replacement.laneEntryEventId });
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(replacement.laneEntryEventId)).toEqual({ status: 'pending', attempt_count: 0 });
      // Keep the replacement out of later pollers' way in this shared test DB.
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=? WHERE id=?')
        .run(Date.now() + 3600_000, replacement.laneEntryEventId);
    });

    it('reconciles a proven final dispatch without a new provider call', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      // Attempt 8 accepted and persisted matching evidence, then crashed
      // before the delivery handoff could commit.
      const acceptedAt = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
        SET attempt_count=8, delivery_phase='dispatch_intent', dispatch_key='k-final',
          accepted_at=?, accepted_dispatch_key='k-final', updated_at=? WHERE id=?`)
        .run(acceptedAt, acceptedAt, run.laneEntryEventId);

      // Direct drain completes the proven delivery without dispatching.
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(true);
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'completed', attempt_count: 8 });
      expect(runSession).not.toHaveBeenCalled();
    });

    it('reconciles a proven final dispatch through poller recovery', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      const acceptedAt = Date.now();
      databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
        SET attempt_count=8, delivery_phase='dispatch_intent', dispatch_key='k-final',
          accepted_at=?, accepted_dispatch_key='k-final', updated_at=? WHERE id=?`)
        .run(acceptedAt, acceptedAt, run.laneEntryEventId);

      await drainPendingLaneEntryTriggers();
      expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toEqual({ status: 'completed', attempt_count: 8 });
      expect(runSession).not.toHaveBeenCalled();
    });

    it('parks a final uncertain dispatch instead of failing it', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      const child = createChildSession(workspace.id, 'Lane worker');
      attachRootSession(run.id, child.id);
      // A final dispatch with intent but no acceptance, carrying stale
      // last-error text from an earlier attempt.
      databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
        SET attempt_count=8, delivery_phase='dispatch_intent', dispatch_key='k-uncertain',
          last_error='some stale boom', updated_at=? WHERE id=?`)
        .run(Date.now(), run.laneEntryEventId);

      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      const event = databaseManager.get().prepare(`SELECT status, attempt_count, delivery_phase,
        dispatch_key, last_error FROM kanban_lane_entry_events WHERE id=?`).get(run.laneEntryEventId);
      expect(event).toMatchObject({ status: 'needs_attention', attempt_count: 8, delivery_phase: 'dispatch_intent' });
      expect(event.dispatch_key).toBe('k-uncertain');
      expect(event.last_error).toMatch(/^ambiguous_dispatch: /);
      expect(runSession).not.toHaveBeenCalled();
      const candidates = getLaneEntryRecoveryCandidates();
      expect(candidates.map((candidate) => candidate.eventId)).toContain(run.laneEntryEventId);
    });

    it('fails a definitively rejected exhausted dispatch without a ninth dispatch', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      // Eight definitive rejections left no unacknowledged intent behind.
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET attempt_count=8 WHERE id=?')
        .run(run.laneEntryEventId);

      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(databaseManager.get().prepare('SELECT status, last_error FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId)).toMatchObject({ status: 'failed' });
      expect(runSession).not.toHaveBeenCalled();
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(runSession).not.toHaveBeenCalled();
    });

    it('preserves uncertainty when the acceptance handoff cannot commit', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Continue the work' });
      const workspace = createSession('Workspace');
      const card = kanbanCards.create(lanes[1].id, workspace.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: workspace.id, cardId: card.id, lane: kanbanLanes.getById(lanes[1].id),
      });
      // The provider accepts, but the claim lease is lost before the handoff
      // commit: the recorded evidence must survive, uncompleted and undispatched.
      runSession.mockImplementationOnce(async (_id, _prompt, _dir, options) => {
        options?.onProviderAccepted?.({ boundary: 'test-acceptance' });
        databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET claim_expires_at=? WHERE id=?')
          .run(Date.now() - 1, run.laneEntryEventId);
        return { started: true };
      });

      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const event = databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key,
        accepted_dispatch_key, attempt_count FROM kanban_lane_entry_events WHERE id=?`)
        .get(run.laneEntryEventId);
      expect(event).toMatchObject({ status: 'needs_attention', delivery_phase: 'dispatch_intent', attempt_count: 1 });
      expect(event.dispatch_key).toEqual(expect.any(String));
      expect(event.accepted_dispatch_key).toBe(event.dispatch_key);
      expect(runSession).toHaveBeenCalledTimes(1);
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
      expect(runSession).toHaveBeenCalledTimes(1);
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
