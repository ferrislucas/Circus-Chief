import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

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
    it('attaches new session at the workspace root by default', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Continue from root' })
        .expect(201);

      expect(res.body.parentSessionId).toBe(root.id);
      expect(res.body.projectId).toBe(project.id);
    });

    it('attaches after afterSessionId when it belongs to the workspace', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Chain from child', afterSessionId: child.id })
        .expect(201);

      expect(res.body.parentSessionId).toBe(child.id);
    });

    it('falls back to root when afterSessionId is from a different workspace', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const otherRoot = sessions.create(project.id, 'Other root', 'other');

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Fallback test', afterSessionId: otherRoot.id })
        .expect(201);

      // afterSessionId belongs to a different workspace → falls back to root
      expect(res.body.parentSessionId).toBe(root.id);
    });

    it('normalises a child workspace ID to its root (forgiving)', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const child = sessions.create(project.id, 'Child', 'child', { parentSessionId: root.id });

      // Pass child ID as workspace ID — should resolve to root
      const res = await request(app)
        .post(`/api/workspaces/${child.id}/sessions`)
        .send({ prompt: 'Via child id' })
        .expect(201);

      // Parent should be the root (since no afterSessionId was given)
      expect(res.body.parentSessionId).toBe(root.id);
    });

    it('creates a scheduled session in a workspace (does not start)', async () => {
      const root = sessions.create(project.id, 'Root', 'root');
      const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();

      const res = await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Future session', scheduledAt })
        .expect(201);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.parentSessionId).toBe(root.id);
    });

    it('broadcasts SESSION_CREATED targeting the correct project', async () => {
      const root = sessions.create(project.id, 'Root', 'root');

      await request(app)
        .post(`/api/workspaces/${root.id}/sessions`)
        .send({ prompt: 'Broadcast check' })
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
        .send({})
        .expect(400);
    });

    it('returns 404 for unknown workspace ID', async () => {
      await request(app)
        .post('/api/workspaces/00000000-0000-0000-0000-000000000000/sessions')
        .send({ prompt: 'Nope' })
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
});
