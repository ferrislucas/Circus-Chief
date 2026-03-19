import { describe, it, expect, beforeEach } from 'vitest';
import { KanbanBoardRepository } from './KanbanBoardRepository.js';
import { KanbanLaneRepository } from './KanbanLaneRepository.js';
import { KanbanCardRepository } from './KanbanCardRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { SessionRepository } from './SessionRepository.js';

describe('KanbanCardRepository', () => {
  let boardRepo;
  let laneRepo;
  let cardRepo;
  let projectRepo;
  let sessionRepo;
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    cardRepo = new KanbanCardRepository();
    projectRepo = new ProjectRepository();
    sessionRepo = new SessionRepository();

    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = boardRepo.create(projectId);
    boardId = board.id;
    lanes = laneRepo.getByBoardId(boardId);
  });

  function createSession(name = 'Test Session') {
    return sessionRepo.create(projectId, name, 'Prompt');
  }

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(cardRepo).toBeInstanceOf(KanbanCardRepository);
      expect(cardRepo.tableName).toBe('kanban_cards');
    });
  });

  describe('create', () => {
    it('creates a card for a session in a lane', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id);

      expect(card).not.toBeNull();
      expect(card.id).toBeDefined();
      expect(card.laneId).toBe(lanes[0].id);
      expect(card.createdAt).toBeTypeOf('number');
      expect(card.updatedAt).toBeTypeOf('number');
    });

    it('includes session data in the card', () => {
      const session = createSession('My Session');
      const card = cardRepo.create(lanes[0].id, session.id);

      expect(card.sessions).toHaveLength(1);
      expect(card.sessions[0].id).toBe(session.id);
      expect(card.sessions[0].name).toBe('My Session');
      expect(card.sessions[0].status).toBe('starting');
    });

    it('auto-assigns sort order at the end', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');

      const card1 = cardRepo.create(lanes[0].id, s1.id);
      const card2 = cardRepo.create(lanes[0].id, s2.id);

      expect(card1.sortOrder).toBe(0);
      expect(card2.sortOrder).toBe(1);
    });

    it('uses provided sort order', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id, { sortOrder: 5 });

      expect(card.sortOrder).toBe(5);
    });

    it('enforces unique session per card (session can only appear once)', () => {
      const session = createSession();
      cardRepo.create(lanes[0].id, session.id);

      // Attempting to create another card for the same session should throw
      // (UNIQUE constraint on kanban_card_sessions.session_id)
      expect(() => cardRepo.create(lanes[1].id, session.id)).toThrow();
    });
  });

  describe('getByLaneId', () => {
    it('returns cards for a lane with session data', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      cardRepo.create(lanes[0].id, s1.id);
      cardRepo.create(lanes[0].id, s2.id);

      const cards = cardRepo.getByLaneId(lanes[0].id);

      expect(cards).toHaveLength(2);
      expect(cards[0].sessions[0].name).toBe('S1');
      expect(cards[1].sessions[0].name).toBe('S2');
    });

    it('returns cards ordered by sort_order', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      cardRepo.create(lanes[0].id, s1.id, { sortOrder: 5 });
      cardRepo.create(lanes[0].id, s2.id, { sortOrder: 1 });

      const cards = cardRepo.getByLaneId(lanes[0].id);

      expect(cards[0].sortOrder).toBe(1);
      expect(cards[1].sortOrder).toBe(5);
    });

    it('returns empty array for empty lane', () => {
      const cards = cardRepo.getByLaneId(lanes[0].id);
      expect(cards).toEqual([]);
    });

    it('returns empty array for non-existent lane', () => {
      const cards = cardRepo.getByLaneId('non-existent');
      expect(cards).toEqual([]);
    });
  });

  describe('getByBoardId', () => {
    it('returns all cards across all lanes', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const s3 = createSession('S3');
      cardRepo.create(lanes[0].id, s1.id);
      cardRepo.create(lanes[1].id, s2.id);
      cardRepo.create(lanes[2].id, s3.id);

      const cards = cardRepo.getByBoardId(boardId);

      expect(cards).toHaveLength(3);
    });

    it('returns cards ordered by lane sort_order then card sort_order', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      cardRepo.create(lanes[2].id, s1.id); // Lane 2
      cardRepo.create(lanes[0].id, s2.id); // Lane 0

      const cards = cardRepo.getByBoardId(boardId);

      // Lane 0 card should come first
      expect(cards[0].sessions[0].name).toBe('S2');
      expect(cards[1].sessions[0].name).toBe('S1');
    });

    it('returns empty array when no cards exist', () => {
      const cards = cardRepo.getByBoardId(boardId);
      expect(cards).toEqual([]);
    });
  });

  describe('getBySessionId', () => {
    it('returns card for a given session', () => {
      const session = createSession('My Session');
      const created = cardRepo.create(lanes[0].id, session.id);

      const card = cardRepo.getBySessionId(session.id);

      expect(card).not.toBeNull();
      expect(card.id).toBe(created.id);
      expect(card.sessions[0].id).toBe(session.id);
    });

    it('returns null when session has no card', () => {
      const session = createSession();
      const card = cardRepo.getBySessionId(session.id);

      expect(card).toBeNull();
    });

    it('returns null for non-existent session', () => {
      const card = cardRepo.getBySessionId('non-existent');
      expect(card).toBeNull();
    });
  });

  describe('moveToLane', () => {
    it('moves a card to a different lane', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id);

      const moved = cardRepo.moveToLane(card.id, lanes[1].id);

      expect(moved).not.toBeNull();
      // Verify the card is now in the new lane
      const cardsInOldLane = cardRepo.getByLaneId(lanes[0].id);
      const cardsInNewLane = cardRepo.getByLaneId(lanes[1].id);

      expect(cardsInOldLane).toHaveLength(0);
      expect(cardsInNewLane).toHaveLength(1);
      expect(cardsInNewLane[0].id).toBe(card.id);
    });

    it('auto-assigns sort order at end of target lane', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      cardRepo.create(lanes[1].id, s1.id); // Already in lane 1
      const card2 = cardRepo.create(lanes[0].id, s2.id);

      cardRepo.moveToLane(card2.id, lanes[1].id);

      const cardsInLane1 = cardRepo.getByLaneId(lanes[1].id);
      expect(cardsInLane1).toHaveLength(2);
      // The moved card should be at the end
      expect(cardsInLane1[1].id).toBe(card2.id);
    });

    it('uses provided sort order', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id);

      cardRepo.moveToLane(card.id, lanes[1].id, 42);

      const cardsInNewLane = cardRepo.getByLaneId(lanes[1].id);
      expect(cardsInNewLane[0].sortOrder).toBe(42);
    });
  });

  describe('reorder', () => {
    it('reorders cards within a lane', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const s3 = createSession('S3');
      const c1 = cardRepo.create(lanes[0].id, s1.id);
      const c2 = cardRepo.create(lanes[0].id, s2.id);
      const c3 = cardRepo.create(lanes[0].id, s3.id);

      // Reverse order
      cardRepo.reorder(lanes[0].id, [c3.id, c2.id, c1.id]);

      const cards = cardRepo.getByLaneId(lanes[0].id);
      expect(cards[0].id).toBe(c3.id);
      expect(cards[1].id).toBe(c2.id);
      expect(cards[2].id).toBe(c1.id);
    });

    it('assigns consecutive sort order values', () => {
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const c1 = cardRepo.create(lanes[0].id, s1.id);
      const c2 = cardRepo.create(lanes[0].id, s2.id);

      cardRepo.reorder(lanes[0].id, [c2.id, c1.id]);

      const cards = cardRepo.getByLaneId(lanes[0].id);
      expect(cards[0].sortOrder).toBe(0);
      expect(cards[1].sortOrder).toBe(1);
    });
  });

  describe('delete', () => {
    it('deletes a card without deleting the session', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id);

      cardRepo.delete(card.id);

      expect(cardRepo.getById(card.id)).toBeNull();
      // Session should still exist
      expect(sessionRepo.getById(session.id)).not.toBeNull();
    });

    it('does not throw when deleting non-existent card', () => {
      expect(() => cardRepo.delete('non-existent')).not.toThrow();
    });
  });

  describe('getById', () => {
    it('returns card with session data', () => {
      const session = createSession('Named Session');
      const created = cardRepo.create(lanes[0].id, session.id);

      const card = cardRepo.getById(created.id);

      expect(card).not.toBeNull();
      expect(card.id).toBe(created.id);
      expect(card.sessions[0].name).toBe('Named Session');
    });

    it('returns null for non-existent ID', () => {
      expect(cardRepo.getById('non-existent')).toBeNull();
    });
  });

  describe('getByIdWithLane', () => {
    it('returns card with lane info', () => {
      const session = createSession();
      const created = cardRepo.create(lanes[0].id, session.id);

      const card = cardRepo.getByIdWithLane(created.id);

      expect(card).not.toBeNull();
      expect(card.boardId).toBe(boardId);
      expect(card.laneName).toBe('To Do');
    });

    it('returns null for non-existent card', () => {
      expect(cardRepo.getByIdWithLane('non-existent')).toBeNull();
    });
  });

  describe('cascade deletes', () => {
    it('deletes cards when lane is deleted', () => {
      const session = createSession();
      const card = cardRepo.create(lanes[0].id, session.id);

      laneRepo.delete(lanes[0].id);

      expect(cardRepo.getById(card.id)).toBeNull();
    });

    it('deletes card_session link when session is deleted', () => {
      const session = createSession();
      cardRepo.create(lanes[0].id, session.id);

      sessionRepo.delete(session.id);

      // The card_session link should be gone since session_id has CASCADE
      const card = cardRepo.getBySessionId(session.id);
      expect(card).toBeNull();
    });
  });
});
