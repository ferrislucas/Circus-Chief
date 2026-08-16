import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  projects,
  sessions,
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  databaseManager,
} from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

// Mock card moves while keeping card creation behavior real.
vi.mock('../services/kanbanService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    moveCard: vi.fn(),
  };
});

import kanbanRouter from './kanban.js';
import { broadcastToProject } from '../websocket.js';
import { moveCard as moveCardService } from '../services/kanbanService.js';
import { ApiError } from '../errors/ApiError.js';
import {
  SESSION_CALLER_ID_HEADER,
  WS_MESSAGE_TYPES,
} from '@circuschief/shared';

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

  function createChildSession(parentId, name = 'Child Session') {
    return sessions.create(projectId, name, 'Child Prompt', {
      mode: 'standard',
      parentSessionId: parentId,
    });
  }

  describe('Idempotency-Key validation', () => {
    it.each([
      ['', 'an empty key'],
      ['   ', 'a whitespace-only key'],
      ['contains space', 'a key containing whitespace'],
      ['x'.repeat(256), 'an overlong key'],
    ])('rejects %s before a card mutation (%s)', async (key) => {
      const { lanes: boardLanes } = setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send({ workspaceId: session.id, laneId: boardLanes[0].id });

      expect(res.status).toBe(400);
      expect(kanbanCards.getBySessionId(session.id)).toBeNull();
    });

    it('replays the original 201 response byte-for-byte for a completed card add', async () => {
      const { lanes: boardLanes } = setupBoard();
      const session = createSession();
      const key = 'card-add-replay';
      const body = { workspaceId: session.id, laneId: boardLanes[0].id };

      const first = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send(body);
      const replay = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send(body);

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.text).toBe(first.text);
      expect(kanbanCards.getBySessionId(session.id)).toMatchObject({ id: first.body.id });
    });

    it('rejects reuse of a key with a different payload without another mutation', async () => {
      const { lanes: boardLanes } = setupBoard();
      const firstSession = createSession('First');
      const secondSession = createSession('Second');
      const key = 'card-add-conflict';

      await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send({ workspaceId: firstSession.id, laneId: boardLanes[0].id });
      const conflict = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send({ workspaceId: secondSession.id, laneId: boardLanes[0].id });

      expect(conflict.status).toBe(409);
      expect(kanbanCards.getBySessionId(secondSession.id)).toBeNull();
    });

    it('accepts a 255-character key and preserves legacy behavior without a key', async () => {
      const { lanes: boardLanes } = setupBoard();
      const keyedSession = createSession('Keyed Session');
      const legacySession = createSession('Legacy Session');

      const keyed = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', 'k'.repeat(255))
        .send({ workspaceId: keyedSession.id, laneId: boardLanes[0].id });
      const legacy = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: legacySession.id, laneId: boardLanes[0].id });

      expect(keyed.status).toBe(201);
      expect(keyed.body.operationId).toEqual(expect.any(String));
      expect(legacy.status).toBe(201);
      expect(legacy.body.operationId).toBeUndefined();
    });

    it('persists and canonically replays a terminal business error', async () => {
      const { lanes: boardLanes } = setupBoard();
      const session = createSession();
      kanbanCards.create(boardLanes[0].id, session.id);
      const body = { workspaceId: session.id, laneId: boardLanes[0].id };

      const first = await request(app).post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', 'existing-card').send(body);
      databaseManager.get().prepare(`UPDATE kanban_api_operations SET lease_expires_at=0
        WHERE project_id=? AND operation_key=?`).run(projectId, 'existing-card');
      const replay = await request(app).post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', 'existing-card').send(body);

      expect(first.status).toBe(409);
      expect(replay.status).toBe(409);
      expect(replay.text).toBe(first.text);
      expect(databaseManager.get().prepare(`SELECT status FROM kanban_api_operations
        WHERE project_id=? AND operation_key=?`).get(projectId, 'existing-card').status).toBe('completed');
    });
  });

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

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/non-existent/kanban');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('GET /api/projects/:projectId/kanban/lane-runs/:runId', () => {
    it('does not reveal a lane run through another project route', async () => {
      const { lanes: projectLanes } = setupBoard();
      const session = createSession();
      const card = kanbanCards.create(projectLanes[0].id, session.id);
      const runId = 'project-scoped-run';
      databaseManager.get().prepare(`INSERT INTO kanban_lane_entry_events
        (id,idempotency_key,project_id,workspace_id,card_id,lane_id,cause,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending',?,?)`)
        .run('project-scoped-event', 'project-scoped-key', projectId, session.id, card.id, projectLanes[0].id, 'card_added', 1, 1);
      databaseManager.get().prepare(`INSERT INTO kanban_lane_runs
        (id,lane_entry_event_id,project_id,workspace_id,card_id,source_lane_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?, 'open', ?, ?)`)
        .run(runId, 'project-scoped-event', projectId, session.id, card.id, projectLanes[0].id, 1, 1);
      const otherProject = projects.create('Other project', '/tmp/other');

      const own = await request(app).get(`/api/projects/${projectId}/kanban/lane-runs/${runId}`);
      const foreign = await request(app).get(`/api/projects/${otherProject.id}/kanban/lane-runs/${runId}`);
      const missing = await request(app).get(`/api/projects/${otherProject.id}/kanban/lane-runs/not-a-run`);

      expect(own.status).toBe(200);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
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

    it('persists a valid completion target on creation', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Automated', onEnterPrompt: 'Do the work', completionTargetLaneId: lanes[0].id });

      expect(res.status).toBe(201);
      expect(res.body.completionTargetLaneId).toBe(lanes[0].id);
    });

    it('rejects a completion target from another board on creation', async () => {
      setupBoard();
      const otherProject = projects.create('Other Project', '/tmp/other', null);
      const otherBoard = kanbanBoards.getOrCreateForProject(otherProject.id);
      const otherLane = kanbanLanes.getByBoardId(otherBoard.id)[0];

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Automated', onEnterPrompt: 'Do the work', completionTargetLaneId: otherLane.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Completion target lane must be on the same board');
    });

    it('rejects a nonexistent completion target on creation', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Automated', onEnterPrompt: 'Do the work', completionTargetLaneId: '550e8400-e29b-41d4-a716-446655440099' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Completion target lane not found');
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

    it('accepts completionTargetLaneId null', async () => {
      setupBoard();
      // A completion target requires on-entry automation (KanbanLaneRepository
      // hard-cutover contract).
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', completionTargetLaneId: lanes[1].id });

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ completionTargetLaneId: null });

      expect(res.status).toBe(200);
      expect(res.body.completionTargetLaneId).toBeNull();
    });

    it('accepts completionTargetLaneId for another lane on the same board', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work' });

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ completionTargetLaneId: lanes[1].id });

      expect(res.status).toBe(200);
      expect(res.body.completionTargetLaneId).toBe(lanes[1].id);
    });

    it('rejects completionTargetLaneId equal to the source lane', async () => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ completionTargetLaneId: lanes[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Completion target lane cannot be the same lane');
    });

    it('rejects completionTargetLaneId from another board', async () => {
      setupBoard();
      const otherProject = projects.create('Other Project', '/tmp/other', null);
      const otherBoard = kanbanBoards.getOrCreateForProject(otherProject.id);
      const otherLanes = kanbanLanes.getByBoardId(otherBoard.id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ completionTargetLaneId: otherLanes[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Completion target lane must be on the same board');
    });

    it('rejects updating a lane through a project route whose board does not own it', async () => {
      setupBoard();
      const otherProject = projects.create('Other Project', '/tmp/other', null);
      kanbanBoards.getOrCreateForProject(otherProject.id);

      const res = await request(app)
        .patch(`/api/projects/${otherProject.id}/kanban/lanes/${lanes[0].id}`)
        .send({ name: 'Wrong Project' });

      expect(res.status).toBe(404);
      expect(kanbanLanes.getById(lanes[0].id).name).not.toBe('Wrong Project');
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
    it('creates a card for a workspace', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: session.id, laneId: lanes[0].id });

      expect(res.status).toBe(201);
      expect(res.body.laneId).toBe(lanes[0].id);
      expect(res.body.sessions[0].id).toBe(session.id);
    });

    it('creates a card for the workflow root when a child workspace ID is provided', async () => {
      setupBoard();
      const root = createSession('Root Session');
      const child = createChildSession(root.id, 'Child Session');

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: child.id, laneId: lanes[0].id });

      expect(res.status).toBe(201);
      expect(res.body.sessions[0].id).toBe(root.id);
      expect(kanbanCards.getBySessionId(root.id)).toBeTruthy();
      expect(kanbanCards.getBySessionId(child.id)).toBeNull();
    });

    it('detects duplicate cards by workflow root session ID', async () => {
      setupBoard();
      const root = createSession('Root Session');
      const child = createChildSession(root.id, 'Child Session');
      kanbanCards.create(lanes[0].id, root.id);

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: child.id, laneId: lanes[1].id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Session already has a card on the board');
    });

    it('rejects workspaceId from another project', async () => {
      setupBoard();
      const otherProject = projects.create('Other Project', '/tmp/other', null);
      const root = sessions.create(otherProject.id, 'Other Root', 'Prompt');

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: root.id, laneId: lanes[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Session does not belong to this project');
    });

    it('rejects a child session that belongs to another project even if root is in this project', async () => {
      setupBoard();
      const otherProject = projects.create('Other Project', '/tmp/other', null);
      // root lives in our project, child lives in otherProject
      const root = createSession('Root in This Project');
      const child = sessions.create(otherProject.id, 'Child in Other Project', 'Prompt', {
        mode: 'standard',
        parentSessionId: root.id,
      });

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: child.id, laneId: lanes[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Session does not belong to this project');
    });

    it('broadcasts KANBAN_CARD_ADDED', async () => {
      setupBoard();
      const session = createSession();

      await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: session.id, laneId: lanes[0].id });

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
        expect.objectContaining({
          projectId,
          laneId: lanes[0].id,
        })
      );
    });

    it('returns 409 when workspace already has a card', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: session.id, laneId: lanes[1].id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Session already has a card on the board');
    });

    it('returns 400 when lane UUID is invalid', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ workspaceId: session.id, laneId: 'non-existent' });

      expect(res.status).toBe(400); // UUID validation fails
    });

    it('returns 400 for missing required fields', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('workspaceId is required');
    });

    it('returns 400 when sessionId is sent instead of workspaceId (no alias)', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .send({ sessionId: session.id, laneId: lanes[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('workspaceId is required');
    });
  });

  describe('PATCH /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId/move', () => {
    it('moves the workspace card to a different lane', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const movedCard = { ...card, laneId: lanes[1].id };
      moveCardService.mockResolvedValueOnce(movedCard);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set(SESSION_CALLER_ID_HEADER, session.id)
        .send({ targetLaneId: lanes[1].id });

      expect(res.status).toBe(200);
      expect(res.body.laneId).toBe(lanes[1].id);
      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ runOnEnterTemplate: true, actorSessionId: session.id })
      );
    });

    it('returns and replays a deferred self-move declaration', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const body = { targetLaneId: lanes[1].id };
      const response = { ...card, deferred: true, chosenExitLaneId: lanes[1].id };
      moveCardService.mockImplementationOnce(async (_cardId, _targetLaneId, options) => (
        options.finalizeMutation({ card: response, eventId: null })
      ));

      const first = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set('Idempotency-Key', 'deferred-self-move')
        .set(SESSION_CALLER_ID_HEADER, session.id)
        .send(body);
      const replay = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set('Idempotency-Key', 'deferred-self-move')
        .set(SESSION_CALLER_ID_HEADER, session.id)
        .send(body);

      expect(first.status).toBe(200);
      expect(first.body).toEqual(expect.objectContaining({ deferred: true, chosenExitLaneId: lanes[1].id }));
      expect(replay.text).toBe(first.text);
      expect(moveCardService).toHaveBeenCalledTimes(1);
    });

    it('persists and replays a same-lane self-move conflict', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      const body = { targetLaneId: lanes[0].id };
      moveCardService.mockRejectedValueOnce(new ApiError('An active lane worker cannot reorder its card within the same lane',
        { status: 409, code: 'KANBAN_SELF_MOVE_SAME_LANE' }));

      const first = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set('Idempotency-Key', 'same-lane-self-move')
        .send(body);
      const replay = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set('Idempotency-Key', 'same-lane-self-move')
        .send(body);

      expect(first.status).toBe(409);
      expect(first.body.code).toBe('KANBAN_SELF_MOVE_SAME_LANE');
      expect(replay.text).toBe(first.text);
      expect(databaseManager.get().prepare(`SELECT status FROM kanban_api_operations
        WHERE project_id=? AND operation_key=?`).get(projectId, 'same-lane-self-move').status).toBe('completed');
    });

    it('returns the terminal conflict when its operation lease is lost in the catch path', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);
      const key = 'lost-terminal-conflict-lease';
      const message = 'An active lane worker cannot reorder its card within the same lane';
      moveCardService.mockImplementationOnce(async () => {
        databaseManager.get().prepare(`UPDATE kanban_api_operations SET owner_token='another-owner'
          WHERE project_id=? AND operation_key=?`).run(projectId, key);
        throw new ApiError(message, { status: 409, code: 'KANBAN_SELF_MOVE_SAME_LANE' });
      });

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set('Idempotency-Key', key)
        .send({ targetLaneId: lanes[0].id });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: message, code: 'KANBAN_SELF_MOVE_SAME_LANE' });
    });

    it('does not infer caller identity from the workspace URL', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      moveCardService.mockResolvedValueOnce({ ...card, laneId: lanes[1].id });

      await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .send({ targetLaneId: lanes[1].id });

      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ actorSessionId: null })
      );
    });

    it('attributes an existing same-project caller without a capability secret', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      moveCardService.mockResolvedValueOnce({ ...card, laneId: lanes[1].id });

      await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .set(SESSION_CALLER_ID_HEADER, session.id)
        .send({ targetLaneId: lanes[1].id });

      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ actorSessionId: session.id })
      );
    });

    it('normalizes child id to workspace root', async () => {
      setupBoard();
      const root = createSession('Root');
      const child = createChildSession(root.id);
      const card = kanbanCards.create(lanes[0].id, root.id);
      const movedCard = { ...card, laneId: lanes[1].id };
      moveCardService.mockResolvedValueOnce(movedCard);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${child.id}/move`)
        .send({ targetLaneId: lanes[1].id });

      expect(res.status).toBe(200);
      expect(moveCardService).toHaveBeenCalledWith(card.id, lanes[1].id, expect.anything());
    });

    it('returns 404 when workspace has no card', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .send({ targetLaneId: lanes[0].id });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No card found for this workspace');
    });

    it('returns 404 for non-existent target lane', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .send({ targetLaneId: '00000000-0000-0000-0000-000000000000' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Target lane not found');
    });

    it('returns 400 for invalid body', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}/move`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId', () => {
    it('does not delete a workspace card through another project route', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const otherProject = projects.create('Other Project', '/tmp/other-delete');

      const res = await request(app).delete(`/api/projects/${otherProject.id}/kanban/cards/by-workspace/${session.id}`);

      expect(res.status).toBe(404);
      expect(kanbanCards.getById(card.id)).not.toBeNull();
    });
    it('removes the workspace card from the board', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
    });

    it('broadcasts KANBAN_CARD_REMOVED', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);

      await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}`
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

    it('normalizes child id to workspace root', async () => {
      setupBoard();
      const root = createSession('Root');
      const child = createChildSession(root.id);
      const card = kanbanCards.create(lanes[0].id, root.id);

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/by-workspace/${child.id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
    });

    it('returns 404 when workspace has no card', async () => {
      setupBoard();
      const session = createSession();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/by-workspace/${session.id}`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No card found for this workspace');
    });
  });

  describe('PATCH /api/projects/:projectId/kanban/cards/:cardId/move', () => {
    it('does not expose or move a card through another project route', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const otherProject = projects.create('Other Project', '/tmp/other');
      const otherBoard = kanbanBoards.create(otherProject.id);
      const otherLane = kanbanLanes.getByBoardId(otherBoard.id)[0];

      const res = await request(app)
        .patch(`/api/projects/${otherProject.id}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: otherLane.id });

      expect(res.status).toBe(404);
      expect(moveCardService).not.toHaveBeenCalled();
    });

    it('rejects a target lane owned by another project', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const otherProject = projects.create('Other Project', '/tmp/other');
      const otherBoard = kanbanBoards.create(otherProject.id);
      const otherLane = kanbanLanes.getByBoardId(otherBoard.id)[0];

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: otherLane.id });

      expect(res.status).toBe(404);
      expect(moveCardService).not.toHaveBeenCalled();
    });

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

    it('uses the same attributed actor path for a card-addressed move', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      moveCardService.mockResolvedValueOnce({ ...card, laneId: lanes[1].id });

      await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .set(SESSION_CALLER_ID_HEADER, session.id)
        .send({ targetLaneId: lanes[1].id });

      expect(moveCardService).toHaveBeenCalledWith(
        card.id,
        lanes[1].id,
        expect.objectContaining({ actorSessionId: session.id })
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

    it('returns 409 when a self-move cannot skip destination automation', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const message = 'An active lane worker cannot skip destination automation when choosing an exit lane';
      moveCardService.mockRejectedValueOnce(new ApiError(message,
        { status: 409, code: 'KANBAN_SELF_MOVE_AUTOMATION_REQUIRED' }));

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: lanes[1].id, runOnEnterTemplate: false });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: message, code: 'KANBAN_SELF_MOVE_AUTOMATION_REQUIRED' });
    });

    it('returns 409 when a self-move supplies a deferred sort order', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const message = 'An active lane worker cannot set a sort order when choosing an exit lane';
      moveCardService.mockRejectedValueOnce(new ApiError(message,
        { status: 409, code: 'KANBAN_SELF_MOVE_SORT_ORDER' }));

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .send({ targetLaneId: lanes[1].id, sortOrder: 7 });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: message, code: 'KANBAN_SELF_MOVE_SORT_ORDER' });
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
      expect(res.body.error).toMatch(/^The operation could not be completed\. Please try again\. Reference ID: [\w-]+$/);
    });

    it('retries a keyed service failure instead of terminally caching its 500 response', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const key = 'retryable-service-failure';
      moveCardService.mockRejectedValueOnce(new Error('Service failure'))
        .mockImplementationOnce(async (_cardId, _targetLaneId, options) => (
          options.finalizeMutation({ card: { ...card, laneId: lanes[1].id }, eventId: null })
        ));

      const first = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .set('Idempotency-Key', key)
        .send({ targetLaneId: lanes[1].id });
      const retry = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .set('Idempotency-Key', key)
        .send({ targetLaneId: lanes[1].id });
      const operation = databaseManager.get().prepare(`SELECT status, lease_expires_at, terminal_error, attempt_count
        FROM kanban_api_operations WHERE project_id=? AND operation_key=?`)
        .get(projectId, key);

      expect(first.status).toBe(500);
      expect(first.body).toEqual(expect.objectContaining({ error: expect.stringMatching(/^The operation could not be completed\. Please try again\. Reference ID: [\w-]+$/) }));
      expect(retry.status).toBe(200);
      expect(retry.body.operationId).toBe(first.body.operationId);
      expect(moveCardService).toHaveBeenCalledTimes(2);
      expect(operation).toEqual(expect.objectContaining({ status: 'completed', lease_expires_at: null, attempt_count: 2 }));
      expect(operation.terminal_error).toMatch(/^The operation could not be completed\. Please try again\. Reference ID: [\w-]+$/);
    });

    it('returns the service failure when its operation lease is lost in the catch path', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const key = 'lost-failure-lease';
      moveCardService.mockImplementationOnce(async () => {
        databaseManager.get().prepare(`UPDATE kanban_api_operations SET owner_token='another-owner'
          WHERE project_id=? AND operation_key=?`).run(projectId, key);
        throw new Error('Service failure');
      });

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/cards/${card.id}/move`)
        .set('Idempotency-Key', key)
        .send({ targetLaneId: lanes[1].id });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/^The operation could not be completed\. Please try again\. Reference ID: [\w-]+$/);
    });
  });

  describe('DELETE /api/projects/:projectId/kanban/cards/:cardId', () => {
    it('does not delete a card through another project route', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const otherProject = projects.create('Other Project', '/tmp/other-card-delete');

      const res = await request(app).delete(`/api/projects/${otherProject.id}/kanban/cards/${card.id}`);

      expect(res.status).toBe(404);
      expect(kanbanCards.getById(card.id)).not.toBeNull();
    });
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
    it('does not reorder a lane through another project route', async () => {
      setupBoard();
      const session = createSession();
      const card = kanbanCards.create(lanes[0].id, session.id);
      const otherProject = projects.create('Other Project', '/tmp/other-reorder');

      const res = await request(app)
        .put(`/api/projects/${otherProject.id}/kanban/lanes/${lanes[0].id}/cards/reorder`)
        .send([card.id]);

      expect(res.status).toBe(404);
    });
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
