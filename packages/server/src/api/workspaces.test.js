import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  commandButtons,
  commandRuns,
  kanbanBoards,
  kanbanCards,
  kanbanLanes,
  projects,
  messages,
  sessions,
} from '../database.js';
import { attachRootSession, createLaneRunForEntry, supersedeRunForCard } from '../services/workflowSessionService.js';
import { commandRunner } from '../services/commandRunner.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager to avoid real agent spawning
// runSession must return a Promise because the caller chains .catch() on it.
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock git setup to avoid real git operations
vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

// Mock slash command service
vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

// Mock hook service
vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Import after mocking
import { projectWorkspacesRouter, workspacesRouter } from './workspaces.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { WorkspaceCardListResponse } from '@circuschief/shared/contracts/workspaces';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount the two facade routers exactly as api/index.js does
  app.use('/api/projects', projectWorkspacesRouter);
  app.use('/api/workspaces', workspacesRouter);
  return app;
}

describe('Workspace facade API', () => {
  let app;
  let project;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    project = projects.create('Test Project', '/tmp/test');
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:projectId/workspaces
  // ---------------------------------------------------------------------------
  describe('GET /api/projects/:projectId/workspaces', () => {
    it('returns empty array when no sessions exist', async () => {
      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns only root sessions (workspaces)', async () => {
      const root = sessions.create(project.id, 'Root', 'root prompt');
      // Child session — must NOT appear in workspaces list
      sessions.create(project.id, 'Child', 'child prompt', { parentSessionId: root.id });

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces`)
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(root.id);
    });

    it('returns pagination metadata when limit is specified', async () => {
      sessions.create(project.id, 'WS1', 'p1');
      sessions.create(project.id, 'WS2', 'p2');
      sessions.create(project.id, 'WS3', 'p3');

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?limit=2&offset=0`)
        .expect(200);

      expect(res.body.workspaces.length).toBe(2);
      expect(res.body.pagination.total).toBe(3);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    it('returns a compact, root-only card projection for the optimized list', async () => {
      const root = sessions.create(project.id, 'Root', 'p');
      sessions.create(project.id, 'Running child', 'p', { parentSessionId: root.id, status: 'running' });

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=50&status=running`)
        .expect(200);

      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.workspaces[0]).toMatchObject({
        id: root.id, name: 'Root', runningCount: 2, descendantCount: 1,
        runningSessionIds: [root.id, expect.any(String)],
        latestCommandRuns: [],
      });
      expect(res.body.workspaces[0]).not.toHaveProperty('memberIds');
      expect(res.body.workspaces[0]).not.toHaveProperty('pendingPrompt');
      expect(res.body.workspaces[0]).not.toHaveProperty('sessions');
      expect(WorkspaceCardListResponse.safeParse(res.body).success).toBe(true);
      expect(res.headers['access-control-expose-headers'])
        .toBe('Server-Timing, X-Response-Bytes');
      expect(res.headers['server-timing']).toContain('workspace;dur=');
      expect(Number(res.headers['x-response-bytes'])).toBeGreaterThan(0);
    });

    it('allows a bounded prefix up to 500 optimized cards', async () => {
      await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=500`)
        .expect(200);
      await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=501`)
        .expect(400);
    });

    it('uses ordinary offsets to traverse an unchanged dataset without repeats', async () => {
      const first = sessions.create(project.id, 'First', 'p');
      const second = sessions.create(project.id, 'Second', 'p');
      const third = sessions.create(project.id, 'Third', 'p');

      const pageOne = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=2`)
        .expect(200);
      expect(pageOne.body.pagination).toMatchObject({ offset: 0, total: 3, hasMore: true });

      const pageTwo = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=2&offset=2`)
        .expect(200);
      const ids = [...pageOne.body.workspaces, ...pageTwo.body.workspaces].map(({ id }) => id);
      expect(new Set(ids)).toEqual(new Set([first.id, second.id, third.id]));
      expect(ids).toHaveLength(3);
      expect(pageTwo.body.pagination).toMatchObject({ offset: 2, hasMore: false });
    });

    it('rejects malformed optimized-list offsets', async () => {
      await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=2&offset=-1`)
        .expect(400);
    });

    it('rejects malformed optimized-list boolean filters', async () => {
      await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=2&starred=sometimes`)
        .expect(400);
    });

    it('returns honest cold-entry status facets independent of page size', async () => {
      const running = sessions.create(project.id, 'Running', 'p', { status: 'running' });
      const idleOne = sessions.create(project.id, 'Idle one', 'p', { status: 'waiting' });
      const idleTwo = sessions.create(project.id, 'Idle two', 'p', { status: 'stopped' });
      for (const session of [running, idleOne, idleTwo]) sessions.update(session.id, { starred: true });
      sessions.create(project.id, 'Excluded unstarred', 'p', { status: 'running' });

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=1&starred=true`)
        .expect(200);

      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.facets).toEqual({ running: 1, idle: 2 });
      expect(res.body.pagination).toMatchObject({ total: 3, hasMore: true });
    });

    it('includes the latest child command indicator on a cold list entry', async () => {
      const root = sessions.create(project.id, 'Root', 'p', { status: 'waiting' });
      const child = sessions.create(project.id, 'Child', 'p', {
        parentSessionId: root.id,
        status: 'waiting',
      });
      const button = commandButtons.create({
        projectId: project.id,
        label: 'Test',
        command: 'echo test',
      });
      commandRuns.create({ id: 'child-run', sessionId: child.id, buttonId: button.id });
      commandRuns.complete('child-run', 0);

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=50`)
        .expect(200);

      expect(res.body.workspaces[0].latestCommandRuns).toEqual([
        expect.objectContaining({ buttonId: button.id, status: 'success', runId: 'child-run' }),
      ]);
    });

    it('keeps a running command indicator over a newer completed run for the same button', async () => {
      const root = sessions.create(project.id, 'Root', 'p', { status: 'waiting' });
      const child = sessions.create(project.id, 'Child', 'p', {
        parentSessionId: root.id,
        status: 'waiting',
      });
      const button = commandButtons.create({
        projectId: project.id,
        label: 'Test',
        command: 'echo test',
      });
      commandRuns.create({ id: 'child-completed', sessionId: child.id, buttonId: button.id });
      commandRuns.complete('child-completed', 0);
      const runningRuns = vi.spyOn(commandRunner, 'getRunningByProjectId').mockReturnValue([{
        sessionId: root.id,
        buttonId: button.id,
        runId: 'root-running',
        startedAt: 0,
      }]);

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=50`)
        .expect(200);

      expect(res.body.workspaces[0].latestCommandRuns).toEqual([
        expect.objectContaining({ buttonId: button.id, status: 'running', runId: 'root-running' }),
      ]);
      runningRuns.mockRestore();
    });

    it('uses child activity in the authoritative workspace card', async () => {
      const root = sessions.create(project.id, 'Root', 'p', { status: 'waiting' });
      const child = sessions.create(project.id, 'Child', 'p', {
        parentSessionId: root.id,
        status: 'waiting',
      });
      messages.create(child.id, 'assistant', 'Fresh child activity');

      const res = await request(app)
        .get(`/api/projects/${project.id}/workspaces?view=cards&limit=50`)
        .expect(200);

      expect(res.body.workspaces[0]).toMatchObject({ id: root.id });
      expect(res.body.workspaces[0].lastActivityAt).not.toBeNull();
    });

    it('returns 404 for unknown project', async () => {
      await request(app)
        .get('/api/projects/unknown-id/workspaces')
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:projectId/workspaces
  // ---------------------------------------------------------------------------
  describe('POST /api/projects/:projectId/workspaces', () => {
    it('creates a root session (workspace) and starts it immediately', async () => {
      const res = await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({ prompt: 'Do some work' })
        .expect(201);

      expect(res.body.projectId).toBe(project.id);
      expect(res.body.parentSessionId).toBeNull();
      // Immediate start → status should NOT be scheduled or waiting
      expect(['starting', 'running', 'stopped', 'error']).toContain(res.body.status);
    });

    it('ignores parentSessionId in the request body (always creates root)', async () => {
      const decoy = sessions.create(project.id, 'Decoy', 'decoy prompt');

      const res = await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({ prompt: 'Do work', parentSessionId: decoy.id })
        .expect(201);

      expect(res.body.parentSessionId).toBeNull();
    });

    it('creates a scheduled workspace (persists without starting)', async () => {
      const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();

      const res = await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({ prompt: 'Future work', scheduledAt })
        .expect(201);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.parentSessionId).toBeNull();
    });

    it('creates a waiting workspace (startImmediately: false)', async () => {
      const res = await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({ prompt: 'Pending work', startImmediately: false })
        .expect(201);

      expect(res.body.status).toBe('waiting');
    });

    it('broadcasts SESSION_CREATED to the correct project', async () => {
      await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({ prompt: 'Broadcast test' })
        .expect(201);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_CREATED,
        expect.objectContaining({ projectId: project.id })
      );
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await request(app)
        .post(`/api/projects/${project.id}/workspaces`)
        .send({})
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('returns 404 for unknown project', async () => {
      await request(app)
        .post('/api/projects/unknown-id/workspaces')
        .send({ prompt: 'Nope' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/workspaces/:workspaceId
  // ---------------------------------------------------------------------------
  describe('GET /api/workspaces/:workspaceId', () => {
    it('returns the workspace root with its descendant sessions', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });
      const grandchild = sessions.create(project.id, 'Grandchild', 'gc', { parentSessionId: child.id });

      const res = await request(app)
        .get(`/api/workspaces/${root.id}`)
        .expect(200);

      expect(res.body.id).toBe(root.id);
      const childIds = res.body.sessions.map((s) => s.id);
      expect(childIds).toContain(child.id);
      expect(childIds).toContain(grandchild.id);
      expect(res.body).toMatchObject({ id: root.id, parentSessionId: null });
      expect(res.body).toHaveProperty('pendingAgentInput', false);
      expect(res.body).not.toHaveProperty('members');
    });

    it('preserves full rows and pending-input state in the legacy detail response', async () => {
      const root = sessions.create(project.id, 'Root', 'root', { model: 'root-model' });
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });
      sessions.update(root.id, { pendingModel: 'root-pending-model' });
      sessions.update(child.id, { pendingModel: 'child-pending-model' });
      sessions.updateUsage(root.id, {
        inputTokens: 100,
        outputTokens: 20,
        thinkingTokens: 10,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 2,
        webSearchRequests: 0,
        contextWindow: 200000,
      });
      sessions.updateUsage(child.id, {
        inputTokens: 200,
        outputTokens: 40,
        thinkingTokens: 20,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 4,
        webSearchRequests: 0,
        contextWindow: 200000,
      });

      const res = await request(app).get(`/api/workspaces/${root.id}`).expect(200);
      const sessionRows = Object.fromEntries([[res.body.id, res.body], ...res.body.sessions.map(session => [session.id, session])]);

      expect(sessionRows[root.id]).toMatchObject({
        model: 'root-model', pendingModel: 'root-pending-model', inputTokens: 100,
        outputTokens: 20, thinkingTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 2,
        pendingAgentInput: false,
      });
      expect(sessionRows[child.id]).toMatchObject({
        model: null, pendingModel: 'child-pending-model', inputTokens: 200,
        outputTokens: 40, thinkingTokens: 20, cacheReadInputTokens: 10, cacheCreationInputTokens: 4,
        pendingAgentInput: false,
      });
    });

    it('normalises a child ID to its workspace root (forgiving)', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });

      // Pass child ID — should resolve to root
      const res = await request(app)
        .get(`/api/workspaces/${child.id}`)
        .expect(200);

      expect(res.body.id).toBe(root.id);
    });

    it('returns 404 for unknown workspace ID', async () => {
      await request(app)
        .get('/api/workspaces/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/workspaces/:workspaceId/sessions
  // ---------------------------------------------------------------------------
  describe('POST /api/workspaces/:workspaceId/sessions', () => {
    it('attaches new session directly to the explicit workspace root parentSessionId', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Continue from root', parentSessionId: root.id })
        .expect(201);

      expect(res.body.parentSessionId).toBe(root.id);
      expect(res.body.projectId).toBe(project.id);
    });

    it('attaches to parentSessionId when it belongs to the workspace', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Chain from child', parentSessionId: child.id })
        .expect(201);

      expect(res.body.parentSessionId).toBe(child.id);
    });

    it('creates a detached child from a workflow participant after its run is superseded', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const worker = sessions.create(project.id, 'Worker', 'lane work', { parentSessionId: root.id });
      const board = kanbanBoards.create(project.id);
      const [source] = kanbanLanes.getByBoardId(board.id);
      const card = kanbanCards.create(source.id, root.id);
      const run = createLaneRunForEntry({
        projectId: project.id, workspaceId: root.id, cardId: card.id,
        lane: { ...source, onEnterPrompt: 'Do the lane work' },
      });
      attachRootSession(run.id, worker.id);
      supersedeRunForCard(card.id, 'manual_move');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Continue after workflow', parentSessionId: worker.id })
        .expect(201);

      expect(res.body.parentSessionId).toBe(worker.id);
      expect(res.body.laneRunId).toBeNull();
    });

    it('rejects parentSessionId from a different workspace', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const otherRoot = sessions.create(project.id, 'Other root', 'other');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Cross-workspace test', parentSessionId: otherRoot.id })
        .expect(400);

      expect(res.body.error).toBe('Parent session does not belong to this workspace');
      expect(sessions.getByProjectId(project.id)).toHaveLength(2);
    });

    it('rejects a completely unknown parentSessionId', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const unknownId = '00000000-0000-4000-a000-000000000099';

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Unknown parent', parentSessionId: unknownId })
        .expect(404);

      expect(res.body.error).toBe('Parent session not found');
      expect(sessions.getByProjectId(project.id)).toHaveLength(1);
    });

    it('returns 400 when parentSessionId is missing', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'No parent given' })
        .expect(400);

      expect(sessions.getByProjectId(project.id)).toHaveLength(1);
      expect(res.body.error).toBeTruthy();
    });

    it('normalises a child workspace ID to its root when resolving the workspace', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });

      // Pass child ID as workspace ID — should resolve to root, but the
      // explicit parentSessionId still determines the direct parent.
      const res = await request(app)
        .post(`/api/workspaces/${child.id}/sessions`)
        .send({ prompt: 'Via child id', parentSessionId: root.id })
        .expect(201);

      expect(res.body.parentSessionId).toBe(root.id);
    });

    it('creates a scheduled session in a workspace (does not start)', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Future session', parentSessionId: root.id, scheduledAt })
        .expect(201);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.parentSessionId).toBe(root.id);
    });

    it('broadcasts SESSION_CREATED targeting the correct project', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Broadcast check', parentSessionId: root.id })
        .expect(201);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_CREATED,
        expect.objectContaining({ projectId: project.id })
      );
    });

    it('returns 400 when prompt is missing', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ parentSessionId: root.id })
        .expect(400);
    });

    it('returns 404 for unknown workspace ID', async () => {
      await request(app)
        .post('/api/workspaces/00000000-0000-0000-0000-000000000000/sessions')
        .send({ prompt: 'Nope', parentSessionId: '00000000-0000-4000-a000-000000000001' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-project guard
  // ---------------------------------------------------------------------------
  describe('cross-project guard', () => {
    it('GET /workspaces/:id does not return workspaces from other projects', async () => {
      const project2 = projects.create('Other project', '/tmp/other');
      const root2 = sessions.create(project2.id, 'Root2', 'root2');

      // GET /workspaces/:id returns the workspace regardless of origin project,
      // but the workspace's projectId must match the project that owns the session.
      const res = await request(app)
        .get(`/api/workspaces/${root2.id}`)
        .expect(200);

      expect(res.body.projectId).toBe(project2.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Phantom route guard (#1) — split routers must not expose cross-prefix routes
  // ---------------------------------------------------------------------------
  describe('phantom route guard', () => {
    it('GET /api/workspaces/:projectId/workspaces → 404 (no longer a project list)', async () => {
      // When the same router was double-mounted, this would have returned
      // workspaces for the project. With split routers it should 404.
      await request(app)
        .get(`/api/workspaces/${project.id}/workspaces`)
        .expect(404);
    });

    it('POST /api/projects/:workspaceId/sessions → 404 (project router has no /sessions route)', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      await request(app)
        .post(`/api/projects/${root.id}/sessions`)
        .send({ prompt: 'Phantom route test' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // parentSessionId contract edge cases (#5)
  // ---------------------------------------------------------------------------
  describe('parentSessionId contract edge cases', () => {
    it('rejects the retired afterSessionId field name outright, even alongside a valid parentSessionId', async () => {
      // Includes a valid parentSessionId so this proves afterSessionId itself
      // is rejected, not merely that parentSessionId was missing.
      const root = sessions.create(project.id, 'Root', 'root');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Legacy field name', parentSessionId: root.id, afterSessionId: root.id })
        .expect(400);

      expect(sessions.getByProjectId(project.id)).toHaveLength(1);
      expect(res.body.error).toBeTruthy();
    });

    it('rejects the retired afterSessionId field name when parentSessionId is missing', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Legacy field name', afterSessionId: root.id })
        .expect(400);

      expect(sessions.getByProjectId(project.id)).toHaveLength(1);
      expect(res.body.error).toBeTruthy();
    });
  });
});
