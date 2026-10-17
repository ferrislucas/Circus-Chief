import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, kanbanBoards, kanbanLanes, kanbanCards, databaseManager } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock hookService
vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Mock gitService (worktree removal)
vi.mock('../services/gitService.js', () => ({
  removeWorktree: vi.fn(),
}));

// Mocks for the kanban lane lifecycle (mirrors kanbanService.test.js)
vi.mock('../services/templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn().mockResolvedValue('rendered prompt'),
  getRootSession: vi.fn((session) => session),
}));

vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/sessionProvider.js', () => ({
  resolveAgentTypeFromModel: vi.fn().mockReturnValue('codex'),
  resolveProviderMetadataFromModel: vi.fn().mockReturnValue({
    kind: 'openai', authToken: 'test-key', commitAttributionOverride: null,
    supportsIdempotentDispatch: true,
  }),
}));

import archiveRouter from './sessions-archive.js';
import { broadcastToProject } from '../websocket.js';
import { executeHookAsync } from '../services/hookService.js';
import { removeWorktree } from '../services/gitService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { addSessionToBoard } from '../services/kanbanService.js';

describe('Sessions Archive API', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', archiveRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'hello');
    // Set session to stopped status so it can be archived
    sessions.update(session.id, { status: 'stopped' });
  });

  describe('POST /:id/archive', () => {
    it('archives without cleanup flag (backward compatibility)', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      // gitWorktree should be preserved when not cleaning up
      expect(res.body.gitWorktree).toBe('/path/to/wt');
    });

    it('archives with cleanup: true — does not modify gitWorktree', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: true });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      // gitWorktree should be preserved even with cleanup: true
      expect(res.body.gitWorktree).toBe('/path/to/wt');
    });

    it('returns 400 for running sessions', async () => {
      sessions.update(session.id, { status: 'running' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Can only archive/);
    });

    it('returns 400 for starting sessions', async () => {
      sessions.update(session.id, { status: 'starting' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Can only archive/);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/api/sessions/nonexistent-id/archive')
        .send({});

      expect(res.status).toBe(404);
    });

    it('executes onSessionDeleted hook when cleanup is true and project has hook configured', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: true });

      expect(res.status).toBe(200);
      expect(executeHookAsync).toHaveBeenCalledWith(
        './cleanup.sh',
        expect.any(String),
        expect.objectContaining({
          sessionId: session.id,
          projectId: project.id,
          sessionName: 'Test Session',
        })
      );
    });

    it('does not execute onSessionDeleted hook when cleanup is false', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: false });

      expect(res.status).toBe(200);
      expect(executeHookAsync).not.toHaveBeenCalled();
    });

    it('does not execute onSessionDeleted hook for non-worktree sessions with cleanup true', async () => {
      // Session has no gitWorktree (branch mode or no git) — hook should NOT fire
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: true });

      expect(res.status).toBe(200);
      expect(executeHookAsync).not.toHaveBeenCalled();
    });

    it('does not execute onSessionDeleted hook when project has no hook configured', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: true });

      expect(res.status).toBe(200);
      expect(executeHookAsync).not.toHaveBeenCalled();
    });

    it('does not execute onSessionDeleted hook for child sessions even with cleanup true', async () => {
      const parentSession = sessions.create(project.id, 'Parent Session', 'parent prompt');
      sessions.update(parentSession.id, { status: 'stopped' });

      const childSession = sessions.create(project.id, 'Child Session', 'child prompt', { parentSessionId: parentSession.id });
      sessions.update(childSession.id, {
        status: 'stopped',
        gitWorktree: '/path/to/wt',
      });
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });

      const res = await request(app)
        .post(`/api/sessions/${childSession.id}/archive`)
        .send({ cleanup: true });

      expect(res.status).toBe(200);
      expect(executeHookAsync).not.toHaveBeenCalled();
    });

    it('broadcasts SESSION_UPDATED via WebSocket on archive', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          projectId: project.id,
          sessionId: session.id,
          session: expect.objectContaining({ archived: true }),
        })
      );
    });

    it('deleteWorktree: true removes the worktree and clears gitWorktree', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });
      removeWorktree.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ deleteWorktree: true });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(removeWorktree).toHaveBeenCalledWith('/tmp/test', '/path/to/wt', true);
      expect(res.body.gitWorktree).toBeNull();
    });

    it('deleteWorktree: true keeps gitWorktree when removal fails (still archives)', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });
      removeWorktree.mockRejectedValue(new Error('git failed'));

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ deleteWorktree: true });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(res.body.gitWorktree).toBe('/path/to/wt');
    });

    it('deleteWorktree: true on a child session does not remove the worktree', async () => {
      const parentSession = sessions.create(project.id, 'Parent Session', 'parent prompt');
      sessions.update(parentSession.id, { status: 'stopped' });

      const childSession = sessions.create(project.id, 'Child Session', 'child prompt', { parentSessionId: parentSession.id });
      sessions.update(childSession.id, {
        status: 'stopped',
        gitWorktree: '/path/to/wt',
      });
      removeWorktree.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/sessions/${childSession.id}/archive`)
        .send({ deleteWorktree: true });

      expect(res.status).toBe(200);
      expect(removeWorktree).not.toHaveBeenCalled();
      expect(res.body.gitWorktree).toBe('/path/to/wt');
    });

    it('deleteWorktree: true with no gitWorktree does not call removeWorktree', async () => {
      removeWorktree.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ deleteWorktree: true });

      expect(res.status).toBe(200);
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('deleteWorktree: true + cleanup: true runs both removal and the hook', async () => {
      sessions.update(session.id, { gitWorktree: '/path/to/wt' });
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });
      removeWorktree.mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ deleteWorktree: true, cleanup: true });

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(removeWorktree).toHaveBeenCalledWith('/tmp/test', '/path/to/wt', true);
      expect(res.body.gitWorktree).toBeNull();
      expect(executeHookAsync).toHaveBeenCalledWith(
        './cleanup.sh',
        expect.any(String),
        expect.objectContaining({
          sessionId: session.id,
          projectId: project.id,
        })
      );
    });
  });

  describe('kanban lane slot release (Issue 17)', () => {
    let laneId;

    function cardRow(cardId) {
      return databaseManager.get().prepare('SELECT * FROM kanban_cards WHERE id=?').get(cardId);
    }

    function openRuns(cardId) {
      return databaseManager.get()
        .prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'")
        .all(cardId);
    }

    async function addWorkspace(name) {
      const root = sessions.create(project.id, name, 'Prompt');
      sessions.update(root.id, { status: 'stopped' });
      return root;
    }

    beforeEach(() => {
      process.env.USE_CODEX_DIRECT_API = '1';
      const board = kanbanBoards.create(project.id);
      const lanes = kanbanLanes.getByBoardId(board.id);
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      laneId = lanes[0].id;
    });

    it('archiving a queued workspace cancels its queued entry without starting it', async () => {
      const first = await addWorkspace('First');
      await addSessionToBoard(first.id, laneId);
      const second = await addWorkspace('Second');
      const queued = await addSessionToBoard(second.id, laneId);
      expect(queued.entryState).toBe('queued');
      const secondCard = kanbanCards.getBySessionId(second.id);
      expect(cardRow(secondCard.id).entry_queued).toBe(1);

      const res = await request(app)
        .post(`/api/sessions/${second.id}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(cardRow(secondCard.id).entry_queued).toBe(0);
      expect(openRuns(secondCard.id)).toHaveLength(0);
    });

    it('archiving a running workspace releases its slot and starts the next queued card', async () => {
      const first = await addWorkspace('First');
      await addSessionToBoard(first.id, laneId);
      const second = await addWorkspace('Second');
      const queued = await addSessionToBoard(second.id, laneId);
      expect(queued.entryState).toBe('queued');
      const firstCard = kanbanCards.getBySessionId(first.id);
      const secondCard = kanbanCards.getBySessionId(second.id);

      const res = await request(app)
        .post(`/api/sessions/${first.id}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(openRuns(firstCard.id)).toHaveLength(0);
      expect(openRuns(secondCard.id)).toHaveLength(1);
      expect(cardRow(secondCard.id).entry_queued).toBe(0);
    });

    it('archiving a child session leaves the workspace root lane state untouched', async () => {
      const root = await addWorkspace('Root');
      await addSessionToBoard(root.id, laneId);
      const card = kanbanCards.getBySessionId(root.id);
      const child = sessions.create(project.id, 'Child', 'child prompt', { parentSessionId: root.id });
      sessions.update(child.id, { status: 'stopped' });

      const res = await request(app)
        .post(`/api/sessions/${child.id}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(openRuns(card.id)).toHaveLength(1);
      expect(cardRow(card.id).entry_queued).toBe(0);
    });

    it('archiving a workspace in an unlimited automated lane still broadcasts the authoritative board (Issue 20)', async () => {
      kanbanLanes.update(laneId, { concurrencyLimit: null });
      const root = await addWorkspace('Solo');
      sessions.update(root.id, { status: 'waiting' });
      await addSessionToBoard(root.id, laneId);
      const card = kanbanCards.getBySessionId(root.id);
      expect(openRuns(card.id)).toHaveLength(1);
      vi.clearAllMocks();

      const res = await request(app)
        .post(`/api/sessions/${root.id}/archive`)
        .send({});
      // The supersession's slot-release drain runs on a microtask.
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.status).toBe(200);
      expect(openRuns(card.id)).toHaveLength(0);
      const boardCalls = broadcastToProject.mock.calls
        .filter(([, type]) => type === WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED);
      expect(boardCalls).toHaveLength(1);
      const board = boardCalls[0][2].board;
      const rendered = board.lanes.flatMap((lane) => lane.cards).find((c) => c.id === card.id);
      expect(rendered.activeLaneRun).toBeNull();
    });

    it('archiving in a limited automated lane broadcasts the board exactly once (Issue 20)', async () => {
      const first = await addWorkspace('First');
      await addSessionToBoard(first.id, laneId);
      const firstCard = kanbanCards.getBySessionId(first.id);
      expect(openRuns(firstCard.id)).toHaveLength(1);
      vi.clearAllMocks();

      const res = await request(app)
        .post(`/api/sessions/${first.id}/archive`)
        .send({});
      // The supersession's slot-release drain runs on a microtask.
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.status).toBe(200);
      const boardCalls = broadcastToProject.mock.calls
        .filter(([, type]) => type === WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED);
      expect(boardCalls).toHaveLength(1);
    });
  });

  describe('POST /:id/unarchive', () => {
    it('unarchives a session', async () => {
      sessions.update(session.id, { archived: true });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/unarchive`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(false);
    });

    it('broadcasts SESSION_UPDATED via WebSocket on unarchive', async () => {
      sessions.update(session.id, { archived: true });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/unarchive`)
        .send();

      expect(res.status).toBe(200);
      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          projectId: project.id,
          sessionId: session.id,
          session: expect.objectContaining({ archived: false }),
        })
      );
    });
  });
});
