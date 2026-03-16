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

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  sessionTemplates,
  sessionSummaries,
} from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import {
  getFullBoard,
  addSessionToBoard,
  moveCard,
  handleTurnCompletion,
  removeSessionFromBoard,
  addSessionToTemplateTargetLane,
} from './kanbanService.js';

describe('kanbanService', () => {
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = kanbanBoards.create(projectId);
    boardId = board.id;
    lanes = kanbanLanes.getByBoardId(boardId);
  });

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
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

    it('returns null when kanban is disabled', () => {
      projects.update(projectId, { kanbanEnabled: false });
      const board = getFullBoard(projectId);
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
    it('adds a session to a lane', () => {
      const session = createSession();
      const card = addSessionToBoard(session.id, lanes[0].id);

      expect(card).not.toBeNull();
      expect(card.laneId).toBe(lanes[0].id);
      expect(card.sessions[0].id).toBe(session.id);
    });

    it('broadcasts KANBAN_CARD_ADDED', () => {
      const session = createSession();
      addSessionToBoard(session.id, lanes[0].id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({
          projectId,
          laneId: lanes[0].id,
        })
      );
    });

    it('throws when session already has a card', () => {
      const session = createSession();
      addSessionToBoard(session.id, lanes[0].id);

      expect(() => addSessionToBoard(session.id, lanes[1].id)).toThrow(
        'Session already has a card on the board'
      );
    });
  });

  // ── moveCard ───────────────────────────────────────────────────────

  describe('moveCard', () => {
    it('moves a card to a different lane', async () => {
      const session = createSession();
      const card = addSessionToBoard(session.id, lanes[0].id);
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
      const card = addSessionToBoard(session.id, lanes[0].id);
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

    it('skips on-enter template when runOnEnterTemplate is false', async () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Auto Template',
        prompt: 'Do something',
      });

      kanbanLanes.update(lanes[1].id, { onEnterTemplateId: template.id });

      const session = createSession();
      const card = addSessionToBoard(session.id, lanes[0].id);
      vi.clearAllMocks();

      await moveCard(card.id, lanes[1].id, { runOnEnterTemplate: false });

      // Should broadcast the move but not create a new session
      expect(broadcastToProject).toHaveBeenCalledTimes(1);
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_MOVED,
        expect.anything()
      );
    });
  });

  // ── handleTurnCompletion ───────────────────────────────────────────

  describe('handleTurnCompletion', () => {
    it('does nothing when session has no targetLaneId', async () => {
      const session = createSession();
      await handleTurnCompletion(session.id);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does nothing for non-existent session', async () => {
      await handleTurnCompletion('non-existent');
      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('creates card in target lane when session has no card yet', async () => {
      const session = createSession();
      sessions.update(session.id, { targetLaneId: lanes[1].id });

      await handleTurnCompletion(session.id);

      const card = kanbanCards.getBySessionId(session.id);
      expect(card).not.toBeNull();
      expect(card.laneId).toBe(lanes[1].id);
    });

    it('broadcasts KANBAN_CARD_ADDED when creating new card', async () => {
      const session = createSession();
      sessions.update(session.id, { targetLaneId: lanes[1].id });

      await handleTurnCompletion(session.id);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({
          projectId,
          laneId: lanes[1].id,
        })
      );
    });

    it('moves existing card to target lane', async () => {
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      sessions.update(session.id, { targetLaneId: lanes[2].id });

      await handleTurnCompletion(session.id);

      const card = kanbanCards.getBySessionId(session.id);
      expect(card.laneId).toBe(lanes[2].id);
    });

    it('clears targetLaneId after processing', async () => {
      const session = createSession();
      sessions.update(session.id, { targetLaneId: lanes[1].id });

      await handleTurnCompletion(session.id);

      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.targetLaneId).toBeNull();
    });

    it('clears targetLaneId when target lane has been deleted', async () => {
      // Create a real lane, assign it as target, then delete the lane.
      // FK SET NULL on kanban_lanes delete should clear target_lane_id automatically.
      const tempLane = kanbanLanes.create(boardId, { name: 'Temp Lane' });
      const session = createSession();
      sessions.update(session.id, { targetLaneId: tempLane.id });

      // Delete the lane - FK SET NULL clears the reference
      kanbanLanes.delete(tempLane.id);

      // handleTurnCompletion should see null targetLaneId and do nothing
      await handleTurnCompletion(session.id);

      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.targetLaneId).toBeNull();
    });

    it('does not move card when already in the target lane', async () => {
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      sessions.update(session.id, { targetLaneId: lanes[0].id });

      await handleTurnCompletion(session.id);

      // Should still clear targetLaneId
      const updatedSession = sessions.getById(session.id);
      expect(updatedSession.targetLaneId).toBeNull();

      // Card should still be in the same lane
      const card = kanbanCards.getBySessionId(session.id);
      expect(card.laneId).toBe(lanes[0].id);
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
  });

  // ── addSessionToTemplateTargetLane ─────────────────────────────────

  describe('addSessionToTemplateTargetLane', () => {
    it('adds session to the lane specified in the template', () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Template',
        prompt: 'Do it',
        targetLaneId: lanes[2].id,
      });

      const session = createSession();
      addSessionToTemplateTargetLane(session.id, template.id);

      const card = kanbanCards.getBySessionId(session.id);
      expect(card).not.toBeNull();
      expect(card.laneId).toBe(lanes[2].id);
    });

    it('does nothing when template has no targetLaneId', () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Template',
        prompt: 'Do it',
      });

      const session = createSession();
      addSessionToTemplateTargetLane(session.id, template.id);

      const card = kanbanCards.getBySessionId(session.id);
      expect(card).toBeNull();
    });

    it('does nothing when template does not exist', () => {
      const session = createSession();
      addSessionToTemplateTargetLane(session.id, 'non-existent');

      const card = kanbanCards.getBySessionId(session.id);
      expect(card).toBeNull();
    });

    it('does not throw when target lane has been deleted', () => {
      // Create a real lane, assign it to template, then delete the lane
      const tempLane = kanbanLanes.create(boardId, { name: 'Temp Lane' });
      const template = sessionTemplates.create({
        projectId,
        name: 'Template',
        prompt: 'Do it',
        targetLaneId: tempLane.id,
      });

      // Delete the lane - FK SET NULL should clear the template's targetLaneId
      kanbanLanes.delete(tempLane.id);

      const session = createSession();
      // Template's targetLaneId is now null, so should do nothing
      expect(() => addSessionToTemplateTargetLane(session.id, template.id)).not.toThrow();

      // Session should not have a card on the board
      const card = kanbanCards.getBySessionId(session.id);
      expect(card).toBeNull();
    });

    it('does not throw when session already has a card', () => {
      const template = sessionTemplates.create({
        projectId,
        name: 'Template',
        prompt: 'Do it',
        targetLaneId: lanes[0].id,
      });

      const session = createSession();
      kanbanCards.create(lanes[1].id, session.id);

      // Should not throw - should log a warning
      expect(() => addSessionToTemplateTargetLane(session.id, template.id)).not.toThrow();
    });
  });
});
