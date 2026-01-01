import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { projects, sessions, sessionTemplates } from '../database.js';

// Mock websocket and sessionManager before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock gitSessionSetup to control git behavior
vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({ workingDirectory: '/tmp/test', gitWorktree: null }),
}));

// Import after mocks are set up
import projectsRouter from './projects.js';
import { broadcastToProject } from '../websocket.js';
import { setupGitForSession } from '../services/gitSessionSetup.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

describe('Projects API', () => {
  let app;
  let tempDir;
  let projectId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);

    // Create temp directory for project
    tempDir = mkdtempSync(join(tmpdir(), 'projects-api-test-'));

    // Initialize as git repo
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    execSync('touch test.txt && git add . && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });

    // Create project
    const project = projects.create('Test Project', tempDir);
    projectId = project.id;

    // Reset mock to return project's working directory
    setupGitForSession.mockResolvedValue({ workingDirectory: tempDir, gitWorktree: null });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/projects/:id/sessions', () => {
    it('broadcasts SESSION_CREATED on successful session creation', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      // Verify broadcastToProject was called with SESSION_CREATED
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][0]).toBe(projectId);
      expect(sessionCreatedCalls[0][2].projectId).toBe(projectId);
      expect(sessionCreatedCalls[0][2].session).toBeDefined();
    });

    it('broadcasts SESSION_UPDATED with error status when git setup fails', async () => {
      // Make git setup fail
      setupGitForSession.mockRejectedValueOnce(new Error('Git checkout failed'));

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Git setup failed');

      // Verify broadcastToProject was called with SESSION_UPDATED and error status
      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(sessionUpdatedCalls.length).toBe(1);
      expect(sessionUpdatedCalls[0][0]).toBe(projectId);
      expect(sessionUpdatedCalls[0][2].projectId).toBe(projectId);
      expect(sessionUpdatedCalls[0][2].session.status).toBe('error');
      expect(sessionUpdatedCalls[0][2].session.error).toBe('Git checkout failed');
    });

    it('includes sessionId in error broadcast payload', async () => {
      setupGitForSession.mockRejectedValueOnce(new Error('Git error'));

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(500);

      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(sessionUpdatedCalls[0][2].sessionId).toBeDefined();
    });

    it('updates session status in database on git setup failure', async () => {
      setupGitForSession.mockRejectedValueOnce(new Error('Git failed'));

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(500);

      // Find the session that was created and check its status
      const allSessions = sessions.getByProjectId(projectId);
      const errorSession = allSessions.find((s) => s.status === 'error');

      expect(errorSession).toBeDefined();
      expect(errorSession.error).toBe('Git failed');
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).post('/api/projects/non-existent-id/sessions').send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({});

      expect(res.status).toBe(400);
    });

    describe('with templateId', () => {
      let templateId;

      beforeEach(() => {
        // Create a template with specific settings
        const template = sessionTemplates.create({
          name: 'Test Template',
          prompt: 'Template prompt',
          projectId: projectId,
          thinkingEnabled: true,
          gitBranch: 'feature/from-template',
          gitMode: 'worktree',
        });
        templateId = template.id;
      });

      afterEach(() => {
        // Clean up template
        if (templateId) {
          sessionTemplates.delete(templateId);
        }
      });

      it('applies template settings when templateId is provided', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: templateId,
          thinkingEnabled: false, // Should be overridden by template
        });

        expect(res.status).toBe(201);

        // Check the session was created with template settings
        const session = sessions.getById(res.body.id);
        expect(session.thinkingEnabled).toBe(true); // From template
      });

      it('sets nextTemplateId on session when templateId is provided', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: templateId,
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        expect(session.nextTemplateId).toBe(templateId);
      });

      it('passes template gitBranch to git setup', async () => {
        await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: templateId,
        });

        expect(setupGitForSession).toHaveBeenCalledWith(
          expect.objectContaining({
            gitBranch: 'feature/from-template',
            gitMode: 'worktree',
          })
        );
      });

      it('ignores non-existent templateId gracefully', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: 'non-existent-template-id',
          thinkingEnabled: false,
        });

        expect(res.status).toBe(201);

        // Session should be created with provided settings, not template settings
        const session = sessions.getById(res.body.id);
        expect(session.thinkingEnabled).toBe(false);
        expect(session.nextTemplateId).toBeNull();
      });

      it('does not override settings when template has null values', async () => {
        // Create template with null settings
        const minimalTemplate = sessionTemplates.create({
          name: 'Minimal Template',
          prompt: 'Minimal prompt',
          projectId: projectId,
          thinkingEnabled: null,
          gitBranch: null,
          gitMode: null,
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: minimalTemplate.id,
          thinkingEnabled: true,
          gitBranch: 'my-branch',
        });

        expect(res.status).toBe(201);

        // Should keep provided values since template has null
        const session = sessions.getById(res.body.id);
        expect(session.thinkingEnabled).toBe(true);

        // Verify git setup was called with provided branch
        expect(setupGitForSession).toHaveBeenCalledWith(
          expect.objectContaining({
            gitBranch: 'my-branch',
          })
        );

        // Clean up
        sessionTemplates.delete(minimalTemplate.id);
      });
    });
  });

  describe('GET /api/projects', () => {
    it('returns all projects', async () => {
      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((p) => p.id === projectId)).toBe(true);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns project by ID', async () => {
      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(projectId);
      expect(res.body.name).toBe('Test Project');
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/non-existent-id');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:id/sessions with archived filter', () => {
    let session1Id;
    let session2Id;
    let session3Id;

    beforeEach(async () => {
      // Create multiple sessions with different archived states
      const session1 = sessions.create(projectId, 'Session 1', 'completed');
      const session2 = sessions.create(projectId, 'Session 2', 'completed');
      const session3 = sessions.create(projectId, 'Session 3', 'running');

      session1Id = session1.id;
      session2Id = session2.id;
      session3Id = session3.id;

      // Archive session1
      sessions.update(session1Id, { archived: true });
    });

    it('returns all sessions when no archived filter is provided', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);

      const sessionIds = res.body.map((s) => s.id);
      expect(sessionIds).toContain(session1Id);
      expect(sessionIds).toContain(session2Id);
      expect(sessionIds).toContain(session3Id);
    });

    it('returns only archived sessions when archived=true', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions?archived=true`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(session1Id);
      expect(res.body[0].archived).toBe(true);
    });

    it('returns only non-archived sessions when archived=false', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions?archived=false`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const sessionIds = res.body.map((s) => s.id);
      expect(sessionIds).toContain(session2Id);
      expect(sessionIds).toContain(session3Id);
      expect(sessionIds).not.toContain(session1Id);

      // Verify all returned sessions are not archived
      res.body.forEach((s) => {
        expect(s.archived).toBe(false);
      });
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/non-existent-id/sessions');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('GET /api/projects/:id/session-defaults', () => {
    it('returns null when project has no defaults set', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/session-defaults`);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it('returns project defaults when set', async () => {
      // Set some defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
        thinkingEnabled: true,
      });

      const res = await request(app).get(`/api/projects/${projectId}/session-defaults`);

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('plan');
      expect(res.body.thinkingEnabled).toBe(true);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('projectId', projectId);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/non-existent-id/session-defaults');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('POST /api/projects/:id/session-defaults', () => {
    it('creates defaults for project', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'worktree',
      });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('plan');
      expect(res.body.thinkingEnabled).toBe(true);
      expect(res.body.gitMode).toBe('worktree');
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
    });

    it('updates existing defaults', async () => {
      // Create initial defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      // Update with new values
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'standard',
        thinkingEnabled: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('standard');
      expect(res.body.thinkingEnabled).toBe(true);
    });

    it('allows partial updates', async () => {
      // Create defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'branch',
      });

      // Update only mode
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'standard',
      });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('standard');
      expect(res.body.thinkingEnabled).toBe(true); // Should remain unchanged
      expect(res.body.gitMode).toBe('branch'); // Should remain unchanged
    });

    it('validates mode enum', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'invalid-mode',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('validates gitMode enum', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        gitMode: 'invalid-gitmode',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).post('/api/projects/non-existent-id/session-defaults').send({
        mode: 'plan',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('accepts empty object (all fields optional)', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/session-defaults`).send({});

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });

  describe('DELETE /api/projects/:id/session-defaults', () => {
    it('resets defaults to system defaults', async () => {
      // Create defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'worktree',
      });

      // Reset
      const res = await request(app).delete(`/api/projects/${projectId}/session-defaults`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();

      // Verify defaults are now null
      const getRes = await request(app).get(`/api/projects/${projectId}/session-defaults`);
      expect(getRes.body.mode).toBeNull();
      expect(getRes.body.thinkingEnabled).toBeNull();
      expect(getRes.body.gitMode).toBeNull();
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).delete('/api/projects/non-existent-id/session-defaults');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('Session creation with project defaults', () => {
    it('applies project mode default when no param provided', async () => {
      // Set project defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.mode).toBe('plan');
    });

    it('applies project thinking default when no param provided', async () => {
      // Set project defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        thinkingEnabled: true,
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.thinkingEnabled).toBe(true);
    });

    it('applies project gitMode and gitBranch defaults', async () => {
      // Set project defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        gitMode: 'worktree',
        gitBranch: 'feature/test',
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      // Verify setupGitForSession was called with defaults
      expect(setupGitForSession).toHaveBeenCalledWith(
        expect.objectContaining({
          gitMode: 'worktree',
          gitBranch: 'feature/test',
        })
      );
    });

    it('applies project model default', async () => {
      // Set project defaults
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        model: 'claude-opus-4',
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.model).toBe('claude-opus-4');
    });

    it('explicit param overrides project default', async () => {
      // Set project default
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      // Create session with explicit mode
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        mode: 'standard',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.mode).toBe('standard'); // Param overrides default
    });

    it('applies each default independently', async () => {
      // Set only mode default, not thinking
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.mode).toBe('plan'); // From project default
      expect(session.thinkingEnabled).toBe(false); // From system default
    });

    it('applies startImmediately default', async () => {
      // Set startImmediately to false
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        startImmediately: false,
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.status).toBe('waiting'); // startImmediately was false
    });

    it('template overrides project defaults', async () => {
      // Set project default
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      // Create template with different mode
      const template = sessionTemplates.create({
        name: 'Override Template',
        prompt: 'Template prompt',
        projectId: projectId,
        thinkingEnabled: true,
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        templateId: template.id,
        thinkingEnabled: false, // Param says false
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      // Template overrides param, so thinking should be true
      expect(session.thinkingEnabled).toBe(true);
    });

    it('uses system defaults when project has no defaults', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.mode).toBe('standard'); // System default
      expect(session.thinkingEnabled).toBe(false); // System default
      expect(session.status).toBe('starting'); // startImmediately default is true
    });
  });
});
