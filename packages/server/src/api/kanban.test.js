import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  projects,
  sessions,
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  commandButtons,
  commandRuns,
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
    // Default to the real implementation so existing POST /cards tests stay
    // behavioral; individual tests can mockRejectedValueOnce over it.
    addSessionToBoard: vi.fn(actual.addSessionToBoard),
    routeWorkspaceCard: vi.fn(actual.routeWorkspaceCard),
  };
});

// Wrap the real queue drain so drain-failure paths can be simulated per test.
vi.mock('../services/kanbanConcurrency.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    drainLaneQueue: vi.fn(actual.drainLaneQueue),
    consumeDeferredEntriesForUnautomatedLane: vi.fn(actual.consumeDeferredEntriesForUnautomatedLane),
  };
});

import kanbanRouter from './kanban.js';
import { broadcastToProject } from '../websocket.js';
import { addSessionToBoard as addSessionToBoardService, routeWorkspaceCard as routeWorkspaceCardService } from '../services/kanbanService.js';
import { ApiError } from '../errors/ApiError.js';
import { kanbanRoutingMetrics } from '../services/kanbanRoutingObservability.js';
import {
  attachRootSession,
  createLaneRunForEntry,
  getRun,
} from '../services/workflowSessionService.js';
import {
  createGatedLaneRunForEntry,
  drainLaneQueue,
} from '../services/kanbanConcurrency.js';
import {
  WS_MESSAGE_TYPES,
} from '@circuschief/shared';

describe('Kanban API', () => {
  let app;
  let projectId;
  let boardId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();
    kanbanRoutingMetrics.reset();

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

  function setupActiveRun() {
    setupBoard();
    const root = createSession('Root');
    const card = kanbanCards.create(lanes[0].id, root.id);
    const run = createLaneRunForEntry({
      projectId,
      workspaceId: root.id,
      cardId: card.id,
      lane: { ...kanbanLanes.getById(lanes[0].id), onEnterPrompt: 'Do the work' },
    });
    const worker = createChildSession(root.id, 'Lane worker');
    attachRootSession(run.id, worker.id);
    return { root, card, run, worker };
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

    it('attaches latestCommandRuns to card sessions', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const button = commandButtons.create({
        projectId,
        label: 'Lint',
        command: 'yarn lint',
        showOnList: true,
      });
      const runId = `run-${Date.now()}`;
      commandRuns.create({ id: runId, sessionId: session.id, buttonId: button.id });
      commandRuns.complete(runId, 0, 'done');

      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      const boardSession = res.body.lanes[0].cards[0].sessions[0];
      expect(boardSession.latestCommandRuns).toHaveLength(1);
      expect(boardSession.latestCommandRuns[0]).toMatchObject({
        buttonId: button.id,
        status: 'success',
        exitCode: 0,
        runId,
      });
    });

    it('returns an empty latestCommandRuns array for sessions without runs', async () => {
      setupBoard();
      const session = createSession();
      kanbanCards.create(lanes[0].id, session.id);

      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      expect(res.body.lanes[0].cards[0].sessions[0].latestCommandRuns).toEqual([]);
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

    it('supersedes active lane runs before the board cascade removes their cards', async () => {
      const { card, run, worker } = setupActiveRun();

      const res = await request(app).delete(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
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

    it('sets and clears concurrencyLimit', async () => {
      setupBoard();

      const set = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: 2 });

      expect(set.status).toBe(200);
      expect(set.body.concurrencyLimit).toBe(2);

      const cleared = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: null });

      expect(cleared.status).toBe(200);
      expect(cleared.body.concurrencyLimit).toBeNull();
    });

    it.each([0, -1, 1.5])('rejects concurrencyLimit %s with KANBAN_LANE_BAD_CONCURRENCY', async (concurrencyLimit) => {
      setupBoard();

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('KANBAN_LANE_BAD_CONCURRENCY');
      expect(res.body.field).toBe('concurrencyLimit');
    });

    it('drains the queue synchronously when the limit is raised', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoardService(runner.id, lanes[0].id);
      const queuedSession = createSession('Queued');
      await addSessionToBoardService(queuedSession.id, lanes[0].id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: 2 });

      expect(res.status).toBe(200);
      const board = await request(app).get(`/api/projects/${projectId}/kanban`);
      const lane = board.body.lanes.find((l) => l.id === lanes[0].id);
      const queuedCard = lane.cards.find((c) => c.sessions[0]?.id === queuedSession.id);
      expect(queuedCard.entryState).toBe('running');
    });

    it('consumes deferred entries as no-ops when lane automation is removed (Issue 10)', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Old prompt', concurrencyLimit: 1 });
      const lane = () => kanbanLanes.getById(lanes[0].id);
      const rootA = createSession('Runner A');
      const cardA = kanbanCards.create(lanes[0].id, rootA.id);
      const runA = createLaneRunForEntry({ projectId, workspaceId: rootA.id, cardId: cardA.id, lane: lane() });
      const rootB = createSession('Queued B');
      const cardB = kanbanCards.create(lanes[0].id, rootB.id);
      expect(createGatedLaneRunForEntry(
        { projectId, workspaceId: rootB.id, cardId: cardB.id, lane: lane() }).queued).toBe(true);

      // Clearing automation (and the completion destination) without touching
      // the limit must still resolve the deferred entry.
      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null });

      expect(res.status).toBe(200);
      const db = databaseManager.get();
      expect(db.prepare('SELECT entry_queued FROM kanban_cards WHERE id=?').get(cardB.id).entry_queued).toBe(0);
      // The existing runner is untouched.
      expect(getRun(runA.id).status).toBe('open');
      expect(db.prepare('SELECT active_lane_run_id FROM kanban_cards WHERE id=?').get(cardA.id).active_lane_run_id).toBe(runA.id);

      // Re-enabling automation must not resurrect the stale entry.
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'New prompt' });
      expect(drainLaneQueue(lanes[0].id)).toEqual([]);
      expect(db.prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'").all(cardB.id)).toHaveLength(0);
    });

    it('drains every deferred entry in lane order when the limit is cleared', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoardService(runner.id, lanes[0].id);
      const firstQueued = createSession('First queued');
      await addSessionToBoardService(firstQueued.id, lanes[0].id);
      const secondQueued = createSession('Second queued');
      await addSessionToBoardService(secondQueued.id, lanes[0].id);

      const res = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: null });

      expect(res.status).toBe(200);
      expect(res.body.concurrencyLimit).toBeNull();
      // Same synchronous drain: no refresh needed, every deferred card runs.
      const board = await request(app).get(`/api/projects/${projectId}/kanban`);
      const lane = board.body.lanes.find((l) => l.id === lanes[0].id);
      const bySession = Object.fromEntries(lane.cards.map((c) => [c.sessions[0]?.id, c]));
      expect(bySession[runner.id].entryState).toBe('running');
      expect(bySession[firstQueued.id].entryState).toBe('running');
      expect(bySession[secondQueued.id].entryState).toBe('running');
      expect(databaseManager.get()
        .prepare('SELECT COUNT(*) count FROM kanban_cards WHERE lane_id=? AND entry_queued=1')
        .get(lanes[0].id).count).toBe(0);
      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
        expect.anything(),
      );
    });

    it('surfaces queue-drain failure when the limit is cleared and retries succeed (Issue 11)', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoardService(runner.id, lanes[0].id);
      const queuedSession = createSession('Queued');
      await addSessionToBoardService(queuedSession.id, lanes[0].id);

      drainLaneQueue.mockImplementationOnce(() => { throw new Error('drain boom'); });
      const failed = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: null });

      // The config commit happened, but the response must not claim success.
      expect(failed.status).toBe(500);
      expect(failed.body.code).toBe('KANBAN_QUEUE_DRAIN_FAILED');
      expect(kanbanLanes.getById(lanes[0].id).concurrencyLimit).toBeNull();

      // Retry path: repeating the same PATCH drains the stranded entries.
      const retry = await request(app)
        .patch(`/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`)
        .send({ concurrencyLimit: null });

      expect(retry.status).toBe(200);
      const queuedCard = kanbanCards.getBySessionId(queuedSession.id);
      expect(databaseManager.get()
        .prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'")
        .all(queuedCard.id)).toHaveLength(1);
    });
  });

  describe('concurrency limits', () => {
    it('creates a lane with concurrencyLimit', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Limited', concurrencyLimit: 2 });

      expect(res.status).toBe(201);
      expect(res.body.concurrencyLimit).toBe(2);
    });

    it('rejects creating a lane with concurrencyLimit 0', async () => {
      setupBoard();

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/lanes`)
        .send({ name: 'Limited', concurrencyLimit: 0 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('KANBAN_LANE_BAD_CONCURRENCY');
      expect(res.body.field).toBe('concurrencyLimit');
    });

    it('routes into a full lane with a queued outcome and position', async () => {
      setupBoard();
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoardService(runner.id, lanes[1].id);
      const other = createSession('Other');
      await addSessionToBoardService(other.id, lanes[0].id);

      const res = await request(app)
        .put(`/api/projects/${projectId}/kanban/cards/by-workspace/${other.id}/lane`)
        .send({ laneId: lanes[1].id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
      expect(res.body.laneId).toBe(lanes[1].id);
      expect(res.body.queuePosition).toBe(1);
    });

    it('exposes concurrencyLimit and entryState on board fetch', async () => {
      setupBoard();
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoardService(runner.id, lanes[0].id);
      const queuedSession = createSession('Queued');
      await addSessionToBoardService(queuedSession.id, lanes[0].id);

      const res = await request(app).get(`/api/projects/${projectId}/kanban`);

      expect(res.status).toBe(200);
      const lane = res.body.lanes.find((l) => l.id === lanes[0].id);
      expect(lane.concurrencyLimit).toBe(1);
      const bySession = Object.fromEntries(
        lane.cards.map((c) => [c.sessions[0]?.id, c]),
      );
      expect(bySession[runner.id].entryState).toBe('running');
      expect(bySession[queuedSession.id].entryState).toBe('queued');
      expect(bySession[queuedSession.id].queuePosition).toBe(1);
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

    it('supersedes active lane runs before the lane cascade removes their cards', async () => {
      const { card, run, worker } = setupActiveRun();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/lanes/${lanes[0].id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
      expect(getRun(run.id).status).toBe('superseded');
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
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

    it('returns an ApiError from card creation terminally instead of as a retryable 500', async () => {
      setupBoard();
      const session = createSession();
      const key = 'api-error-card-add';
      addSessionToBoardService.mockRejectedValueOnce(new ApiError('Session no longer owns an active lane run', {
        status: 409, code: 'LANE_RUN_OWNERSHIP_LOST',
      }));

      const res = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send({ workspaceId: session.id, laneId: lanes[0].id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Session no longer owns an active lane run');
      expect(res.body.code).toBe('LANE_RUN_OWNERSHIP_LOST');

      // Terminal, not retryable: a same-key replay returns the same response
      // without re-running the deterministically-failing mutation.
      const replay = await request(app)
        .post(`/api/projects/${projectId}/kanban/cards`)
        .set('Idempotency-Key', key)
        .send({ workspaceId: session.id, laneId: lanes[0].id });
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe('LANE_RUN_OWNERSHIP_LOST');
      expect(addSessionToBoardService).toHaveBeenCalledTimes(1);

      const operation = databaseManager.get().prepare(`SELECT status FROM kanban_api_operations
        WHERE project_id=? AND operation_key=?`).get(projectId, key);
      expect(operation.status).toBe('completed');
    });
  });

  describe('PUT /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId/lane', () => {
    it('moves a workspace card with only laneId', async () => {
      setupBoard();
      const root = createSession();
      const card = kanbanCards.create(lanes[0].id, root.id);
      const res = await request(app).put(`/api/projects/${projectId}/kanban/cards/by-workspace/${root.id}/lane`).send({ laneId: lanes[1].id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'moved', laneId: lanes[1].id });
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
    });

    it('normalizes a child id and immediately moves despite an active run', async () => {
      const { worker, run, card } = setupActiveRun();
      const res = await request(app).put(`/api/projects/${projectId}/kanban/cards/by-workspace/${worker.id}/lane`).send({ laneId: lanes[1].id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'moved', laneId: lanes[1].id });
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      expect(getRun(run.id)).toMatchObject({
        status: 'superseded', chosenExitLaneId: null, failureReason: 'manual_card_move',
      });
      expect(broadcastToProject).toHaveBeenCalledWith(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, expect.objectContaining({
        cardId: card.id, fromLaneId: lanes[0].id, toLaneId: lanes[1].id,
      }));
    });

    it('reports a current-lane request during an active run as a no-op', async () => {
      const { root, run, card } = setupActiveRun();
      const res = await request(app).put(`/api/projects/${projectId}/kanban/cards/by-workspace/${root.id}/lane`).send({ laneId: lanes[0].id });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'noop', laneId: lanes[0].id });
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[0].id);
      expect(getRun(run.id).chosenExitLaneId).toBeNull();
      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('rejects malformed route bodies', async () => {
      setupBoard();
      const root = createSession();
      kanbanCards.create(lanes[0].id, root.id);
      const res = await request(app).put(`/api/projects/${projectId}/kanban/cards/by-workspace/${root.id}/lane`).send({ targetLaneId: lanes[1].id });
      expect(res.status).toBe(400);
      expect(kanbanRoutingMetrics.snapshot().rejected.validation).toBe(1);
    });

    it('returns 503 for exhausted retryable route contention', async () => {
      setupBoard();
      const root = createSession();
      kanbanCards.create(lanes[0].id, root.id);
      routeWorkspaceCardService.mockRejectedValueOnce(new ApiError('Lane routing is temporarily busy; please retry', {
        status: 503, code: 'KANBAN_ROUTE_RETRYABLE',
      }));

      const res = await request(app).put(`/api/projects/${projectId}/kanban/cards/by-workspace/${root.id}/lane`)
        .send({ laneId: lanes[1].id });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'Lane routing is temporarily busy; please retry', code: 'KANBAN_ROUTE_RETRYABLE' });
      expect(kanbanRoutingMetrics.snapshot().rejected.contention).toBe(1);
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

    it('supersedes an active lane run before removing the card', async () => {
      const { root, card, run, worker } = setupActiveRun();

      const res = await request(app).delete(
        `/api/projects/${projectId}/kanban/cards/by-workspace/${root.id}`
      );

      expect(res.status).toBe(204);
      expect(kanbanCards.getById(card.id)).toBeNull();
      // The open run is retired rather than orphaned pointing at a deleted card.
      expect(getRun(run.id).status).toBe('superseded');
      // The worker's obligation is cancelled so it can't later revive against a
      // card that no longer exists.
      expect(sessions.getById(worker.id).ownWorkState).toBe('cancelled');
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

});
