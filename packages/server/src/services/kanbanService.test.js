import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  runSession: vi.fn().mockResolvedValue(undefined),
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
  removeSessionFromBoard,
  triggerStructuredTransitionAutomation,
  drainLaneEntryTrigger,
  reclaimExpiredLaneEntryClaims,
} from './kanbanService.js';
import { createLaneRunForEntry, attachRootSession, finalizeOwnWorkCompletion, getRun } from './workflowSessionService.js';
import { reconcileKanbanOwnership } from './kanbanRecoveryService.js';
import { resolveProviderMetadataFromModel } from './sessionProvider.js';

describe('kanbanService', () => {
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();
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

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
  }

  function createChildSession(parentId, name = 'Child Session') {
    return sessions.create(projectId, name, 'Child Prompt', {
      mode: 'standard',
      parentSessionId: parentId,
    });
  }

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
      expect(childSession.laneTriggerDepth).toBe(1);
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

    it('does not cancel a lane worker that moves its own card', async () => {
      // A lane prompt may tell the worker to choose its exit lane. That move
      // arrives mid-turn against the worker's own run, so treating it as a
      // supersession made the agent abort itself and strand its own status.
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: session.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'review', completionTargetLaneId: lanes[2].id },
      });
      const worker = sessions.create(projectId, 'Worker', 'lane work', { parentSessionId: session.id });
      attachRootSession(run.id, worker.id);
      databaseManager.get().prepare("UPDATE sessions SET status='running' WHERE id=?").run(worker.id);

      await moveCard(card.id, lanes[1].id, { actorSessionId: worker.id });

      expect(sessions.getById(worker.id).status).toBe('running');
      expect(sessions.getById(worker.id).ownWorkState).toBe('open');
      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
    });

    it('defers destination automation until the self-moving worker finishes', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const sourceRun = createLaneRunForEntry({
        projectId, workspaceId: session.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'review' },
      });
      const worker = sessions.create(projectId, 'Worker', 'lane work', { parentSessionId: session.id });
      attachRootSession(sourceRun.id, worker.id);
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'validate' });

      await moveCard(card.id, lanes[1].id, { actorSessionId: worker.id });

      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
      expect(runSession).not.toHaveBeenCalled();
      const completed = finalizeOwnWorkCompletion(worker.id);
      expect(completed.pendingTargetLaneTrigger).toEqual(expect.objectContaining({
        targetLaneId: lanes[1].id,
        sourceRunId: sourceRun.id,
      }));
      expect(kanbanCards.getById(card.id).activeLaneRunId).not.toBeNull();
      expect(runSession).not.toHaveBeenCalled();
    });

    it('keeps destination automation disabled for an opted-out self-move', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const sourceRun = createLaneRunForEntry({
        projectId, workspaceId: session.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'review' },
      });
      const worker = sessions.create(projectId, 'Worker', 'lane work', { parentSessionId: session.id });
      attachRootSession(sourceRun.id, worker.id);
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'validate' });

      await moveCard(card.id, lanes[1].id, { actorSessionId: worker.id, runOnEnterTemplate: false });
      const completed = finalizeOwnWorkCompletion(worker.id);

      expect(completed.pendingTargetLaneTrigger).toBeUndefined();
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBeNull();
      expect(runSession).not.toHaveBeenCalled();
    });

    it('rejects a self-reorder while preserving the active run', async () => {
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: session.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'review' },
      });
      const worker = sessions.create(projectId, 'Worker', 'lane work', { parentSessionId: session.id });
      attachRootSession(run.id, worker.id);

      await expect(moveCard(card.id, lanes[0].id, { actorSessionId: worker.id, sortOrder: 7 }))
        .rejects.toThrow('cannot reorder its card within the same lane');

      expect(getRun(run.id).status).toBe('open');
      expect(kanbanCards.getById(card.id).activeLaneRunId).toBe(run.id);
    });

    it('still cancels a lane worker when the move comes from outside (no actor)', async () => {
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

      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
      expect(sessions.getById(worker.id).status).toBe('stopped');
      expect(getRun(run.id).status).toBe('superseded');
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
