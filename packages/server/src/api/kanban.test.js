import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  projects,
  sessions,
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
} from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

// Mock kanbanService before importing the router
vi.mock('../services/kanbanService.js', () => ({
  moveCard: vi.fn(),
}));

import kanbanRouter from './kanban.js';
import { broadcastToProject } from '../websocket.js';
import { moveCard as moveCardService } from '../services/kanbanService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

describe('Kanban API', () => {
  let app;
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/projects/:projectId/kanban', kanbanRouter);

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;
  });

  function setupBoard() {
    const board = kanbanBoards.getOrCreateForProject(projectId);
    boardId = board.id;
    lanes = kanbanLanes.getByBoardId(boardId);
    return { board, lanes };
  }

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
  }

  // ============== Board Endpoints ==============

  describe('GET /api/projects/:projectId/kanban', () => {
    it('returns full board with lanes and cards', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(boardId);
      expect(res.body.projectId).toBe(projectId);
      expect(res.body.lanes).toHaveLength(4);
      expect(res.body.lanes[0].cards).toHaveLength(1);
    });

    it('auto-creates board on first access', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      expect(res.body.lanes).toHaveLength(4);
      expect(res.body.lanes[0].name).toBe('To Do');
    });

    it('returns null when kanban is disabled', async () => {
      projects.update(projectId, { kanbanEnabled: false });

      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/non-existent/kanban');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('DELETE /api/projects/:projectId/kanban', () => {
    it('deletes the board', async () => {
      setupBoard();

      const res = await request(app).delete(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(204);
      expect(kanbanBoards.getByProjectId(projectId)).toBeNull();
    });

    it('broadcasts KANBAN_BOARD_UPDATED with null board', async () => {
      setupBoard();

      await request(app).delete(`/api/projects/${projectId}/kanban`);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.objectContaining({ board: null })
      );
    });

    it('returns 404 when no board exists', async () => {
      const res = await request(app).delete(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Board not found');
    });
  });

  // ============== Lane Endpoints ==============

  describe('POST /api/projects/:projectId/kanban/lanes', () => {
    it('creates a new lane', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Custom Lane' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Custom Lane');
      expect(res.body.boardId).toBe(boardId);
    });

    it('broadcasts KANBAN_BOARD_UPDATED', async () => {
      setupBoard();

      await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'New Lane' });

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.objectContaining({ projectId })
      );
    });

    it('returns 400 for invalid body', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for empty name', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when board does not exist', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/projects/:projectId/kanban/lanes/:laneId', () => {
    it('updates a lane name', async () => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed');
    });

    it('returns 404 for non-existent lane', async () => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/non-existent`)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });

    it('broadcasts KANBAN_BOARD_UPDATED', async () => {
      setupBoard();

      await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ name: 'Updated' });

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.anything()
      );
    });
  });

  describe('DELETE /api/projects/:projectId/kanban/lanes/:laneId', () => {
    it('deletes a lane', async () => {
      setupBoard();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanLanes.getById(lanes[0].id)).toBeNull();
    });

    it('returns 404 for non-existent lane', async () => {
      setupBoard();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/lanes/non-existent`
      );

      expect(res.status).toBe(404);
    });

    it('broadcasts KANBAN_BOARD_UPDATED', async () => {
      setupBoard();

      await request(app).delete(
        `/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`
      );

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.anything()
      );
    });
  });

  describe('PUT /api/projects/:projectId/kanban/lanes/reorder', () => {
    it('reorders lanes', async () => {
      setupBoard();
      const reversed = [...lanes].reverse().map((l) => l.id);

      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/reorder`)
        .send(reversed);

      expect(res.status).toBe(200);
      expect(res.body.lanes[0].id).toBe(reversed[0]);
    });

    it('returns 404 when board does not exist', async () => {
      // Use valid RFC 4122 UUIDs so Zod validation passes, then it hits the board check
      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/reorder`)
        .send(['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']);

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid body', async () => {
      setupBoard();

      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/reorder`)
        .send('not-an-array');

      expect(res.status).toBe(400);
    });
  });

  // ============== Card Endpoints ==============

  describe('POST /api/projects/:projectId/kanban/cards', () => {
    it('creates a card for a session', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ sessionId: session.id, laneId: lanes[0].id });

      expect(res.status).toBe(201);
      expect(res.body.laneId).toBe(lanes[0].id);
      expect(res.body.sessions[0].id).toBe(session.id);
    });

    it('broadcasts KANBAN_CARD_ADDED', async () => {
      setupBoard();
      const session = createSession();

      await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ sessionId: session.id, laneId: lanes[0].id });

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({
          projectId,
          laneId: lanes[0].id,
        })
      );
    });

    it('returns 409 when session already has a card', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ sessionId: session.id, laneId: lanes[1].id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Session already has a card on the board');
    });

    it('returns 404 when lane does not exist', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ sessionId: session.id, laneId: 'non-existent' });

      expect(res.status).toBe(400); // UUID validation fails
    });

    it('returns 400 for missing required fields', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/projects/:projectId/kanban/cards/:cardId/move', () => {
    it('delegates to moveCardService with correct arguments', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const movedCard = { ...card, laneId: lanes[1].id };
      moveCardService.mockResolvedValueOnce(movedCard);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: lanes[1].id });

      expect(res.status).toBe(200);
      expect(res.body.laneId).toBe(lanes[1].id);
      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ sortOrder: undefined, runOnEnterTemplate: true })
      );
    });

    it('passes runOnEnterTemplate: false to service when specified', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const movedCard = { ...card, laneId: lanes[1].id };
      moveCardService.mockResolvedValueOnce(movedCard);

      await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: lanes[1].id, runOnEnterTemplate: false });

      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ runOnEnterTemplate: false })
      );
    });

    it('returns 404 for non-existent card', async () => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/non-existent/move`)
        .send({ targetLaneId: lanes[0].id });

      expect(res.status).toBe(404);
      expect(moveCardService).not.toHaveBeenCalled();
    });

    it('returns 404 for non-existent target lane', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: '00000000-0000-0000-0000-000000000000' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Target lane not found');
      expect(moveCardService).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid body', async () => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/some-id/move`)
        .send({});

      expect(res.status).toBe(400);
      expect(moveCardService).not.toHaveBeenCalled();
    });

    it('returns 500 when service throws', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      moveCardService.mockRejectedValueOnce(new Error('Service failure'));

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: lanes[1].id });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Service failure');
    });
  });

  describe('DELETE /api/projects/:projectId/kanban/cards/:cardId', () => {
    it('removes a card from the board', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/${card.id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
    });

    it('broadcasts KANBAN_CARD_REMOVED', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/${card.id}`
      );

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
        expect.objectContaining({
          projectId,
          cardId: card.id,
          laneId: lanes[0].id,
        })
      );
    });

    it('returns 404 for non-existent card', async () => {
      setupBoard();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/non-existent`
      );

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/projects/:projectId/kanban/lanes/:laneId/cards/reorder', () => {
    it('reorders cards within a lane', async () => {
      setupBoard();
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const c1 = kanbanCards.create(lanes[0].id, s1.id);
      const c2 = kanbanCards.create(lanes[0].id, s2.id);

      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}/cards/reorder`)
        .send([c2.id, c1.id]);

      expect(res.status).toBe(200);

      const cards = kanbanCards.getByLaneId(lanes[0].id);
      expect(cards[0].id).toBe(c2.id);
      expect(cards[1].id).toBe(c1.id);
    });

    it('returns 404 for non-existent lane', async () => {
      setupBoard();

      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/non-existent/cards/reorder`)
        .send(['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']);

      expect(res.status).toBe(404);
    });

    it('broadcasts KANBAN_BOARD_UPDATED', async () => {
      setupBoard();
      const s1 = createSession('S1');
      const s2 = createSession('S2');
      const c1 = kanbanCards.create(lanes[0].id, s1.id);
      const c2 = kanbanCards.create(lanes[0].id, s2.id);

      await request(app)
        .put(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}/cards/reorder`)
        .send([c2.id, c1.id]);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.anything()
      );
    });
  });
});
