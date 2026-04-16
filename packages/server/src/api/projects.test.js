import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { projects, sessions, sessionTemplates, commandButtons, commandRuns } from '../database.js';

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
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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

    describe('git repo validation', () => {
      it('succeeds for git repo when gitMode is missing (defaults to none)', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          gitBranch: 'feature-x',
        });

        expect(res.status).toBe(201);

        // gitBranch should be preserved from the request
        const session = sessions.getById(res.body.id);
        expect(session.gitBranch).toBe('feature-x');
      });

      it('succeeds for git repo when gitBranch is missing (defaults to main)', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          gitMode: 'worktree',
        });

        expect(res.status).toBe(201);

        // gitBranch should default to 'main'
        const session = sessions.getById(res.body.id);
        expect(session.gitBranch).toBe('main');
      });

      it('succeeds for git repo when both gitMode and gitBranch are missing (defaults applied)', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
        });

        expect(res.status).toBe(201);

        // gitBranch should default to 'main'
        const session = sessions.getById(res.body.id);
        expect(session.gitBranch).toBe('main');
      });

      it('succeeds for non-git project without gitMode/gitBranch', async () => {
        // Create a temp directory WITHOUT git init
        const nonGitDir = mkdtempSync(join(tmpdir(), 'non-git-test-'));
        try {
          const nonGitProject = projects.create('Non-Git Project', nonGitDir);

          const res = await request(app)
            .post(`/api/projects/${nonGitProject.id}/sessions`)
            .send({ prompt: 'Test prompt' });

          expect(res.status).toBe(201);
        } finally {
          rmSync(nonGitDir, { recursive: true, force: true });
        }
      });

      it('project defaults satisfy git requirement', async () => {
        // Set gitMode and gitBranch as project defaults
        await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
          gitMode: 'worktree',
          gitBranch: 'default-branch',
        });

        // Request without git settings - project defaults should satisfy validation
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
        });

        expect(res.status).toBe(201);
      });

      it('template overrides satisfy git requirement', async () => {
        // Create template with gitMode and gitBranch
        const template = sessionTemplates.create({
          name: 'Git Template',
          prompt: 'Template prompt',
          projectId,
          gitMode: 'worktree',
          gitBranch: 'template-branch',
        });

        // Request using templateId but no explicit git settings
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: template.id,
        });

        expect(res.status).toBe(201);

        // Clean up
        sessionTemplates.delete(template.id);
      });
    });

    describe('effortLevel cascade', () => {
      it('uses project default effortLevel when not explicitly provided', async () => {
        // Set project default
        await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
          effortLevel: 'high',
        });

        // Create session without explicit effortLevel (also provide git settings for validation)
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          gitMode: 'worktree',
          gitBranch: 'test-branch',
        });

        expect(res.status).toBe(201);
        expect(res.body.effortLevel).toBe('high');

        // Clean up
        await request(app).delete(`/api/projects/${projectId}/session-defaults`);
      });

      it('explicit effortLevel overrides project default', async () => {
        // Set project default
        await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
          effortLevel: 'low',
        });

        // Create session with explicit effortLevel (also provide git settings for validation)
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          effortLevel: 'max',
          gitMode: 'worktree',
          gitBranch: 'test-branch',
        });

        expect(res.status).toBe(201);
        expect(res.body.effortLevel).toBe('max');

        // Clean up
        await request(app).delete(`/api/projects/${projectId}/session-defaults`);
      });

      it('uses system default (null) when neither project default nor explicit value provided', async () => {
        // Ensure no project defaults are set
        await request(app).delete(`/api/projects/${projectId}/session-defaults`);

        // Create session without effortLevel (also provide git settings for validation)
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          gitMode: 'worktree',
          gitBranch: 'test-branch',
        });

        expect(res.status).toBe(201);
        expect(res.body.effortLevel).toBeNull();
      });

      it('accepts all valid effortLevel values', async () => {
        for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
          const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
            prompt: 'Test prompt',
            effortLevel,
            gitMode: 'worktree',
            gitBranch: 'test-branch',
          });

          expect(res.status).toBe(201);
          // 'auto' is normalized to null
          const expectedValue = effortLevel === 'auto' ? null : effortLevel;
          expect(res.body.effortLevel).toBe(expectedValue);
        }
      });
    });

    describe('with templateId', () => {
      let templateId;

      beforeEach(() => {
        // Create a template with specific settings
        const template = sessionTemplates.create({
          name: 'Test Template',
          prompt: 'Template prompt',
          projectId,
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
          templateId,
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
          templateId,
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        expect(session.nextTemplateId).toBe(templateId);
      });

      it('passes template gitBranch to git setup', async () => {
        await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId,
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
          gitMode: 'worktree',
          gitBranch: 'test-branch',
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
          projectId,
          thinkingEnabled: null,
          gitBranch: null,
          gitMode: null,
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: minimalTemplate.id,
          thinkingEnabled: true,
          gitBranch: 'my-branch',
          gitMode: 'worktree',
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

      it('applies template effortLevel when provided', async () => {
        // Create template with effortLevel (include git settings since project is a git repo)
        const effortTemplate = sessionTemplates.create({
          name: 'Effort Level Template',
          prompt: 'Template with effort level',
          projectId,
          effortLevel: 'high',
          gitBranch: 'feature/effort',
          gitMode: 'worktree',
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: effortTemplate.id,
        });

        expect(res.status).toBe(201);

        // Session should have effortLevel from template
        const session = sessions.getById(res.body.id);
        expect(session.effortLevel).toBe('high');

        // Clean up
        sessionTemplates.delete(effortTemplate.id);
      });

      it('applies template effortLevel="max" when provided', async () => {
        const effortTemplate = sessionTemplates.create({
          name: 'Max Effort Template',
          prompt: 'Template with max effort',
          projectId,
          effortLevel: 'max',
          gitBranch: 'feature/max',
          gitMode: 'worktree',
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: effortTemplate.id,
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        expect(session.effortLevel).toBe('max');

        // Clean up
        sessionTemplates.delete(effortTemplate.id);
      });

      it('does not override explicit effortLevel when template has null', async () => {
        const nullEffortTemplate = sessionTemplates.create({
          name: 'Null Effort Template',
          prompt: 'Template with null effort',
          projectId,
          effortLevel: null,
          gitBranch: 'feature/null-effort',
          gitMode: 'worktree',
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: nullEffortTemplate.id,
          effortLevel: 'medium',
        });

        expect(res.status).toBe(201);

        // Should keep provided value since template has null
        const session = sessions.getById(res.body.id);
        expect(session.effortLevel).toBe('medium');

        // Clean up
        sessionTemplates.delete(nullEffortTemplate.id);
      });
    });

    describe('with nextTemplateId', () => {
      it('sets nextTemplateId when provided without templateId', async () => {
        // Create a template to reference
        const template = sessionTemplates.create({
          name: 'Chain Template',
          prompt: 'Chain prompt',
          projectId,
          thinkingEnabled: true,
          gitBranch: 'feature/chain',
          gitMode: 'worktree',
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          nextTemplateId: template.id,
          gitMode: 'worktree',
          gitBranch: 'test-branch',
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        expect(session.nextTemplateId).toBe(template.id);
        // Template settings should NOT be applied (no templateId was provided)
        expect(session.thinkingEnabled).toBe(false); // system default

        // Clean up
        sessionTemplates.delete(template.id);
      });

      it('validates nextTemplateId references an existing template', async () => {
        const fakeUUID = '00000000-0000-4000-8000-000000000000';

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          nextTemplateId: fakeUUID,
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('nextTemplateId references a non-existent template');
      });

      it('allows nextTemplateId to be null', async () => {
        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          nextTemplateId: null,
          gitMode: 'worktree',
          gitBranch: 'test-branch',
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        expect(session.nextTemplateId).toBeNull();
      });

      it('explicit nextTemplateId overrides templateId-derived value', async () => {
        // Create two templates
        const templateA = sessionTemplates.create({
          name: 'Template A',
          prompt: 'Prompt A',
          projectId,
          thinkingEnabled: true,
          gitBranch: 'feature/a',
          gitMode: 'worktree',
        });
        const templateB = sessionTemplates.create({
          name: 'Template B',
          prompt: 'Prompt B',
          projectId,
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: templateA.id,
          nextTemplateId: templateB.id,
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        // Template A's settings should be applied
        expect(session.thinkingEnabled).toBe(true);
        // But nextTemplateId should be B, not A
        expect(session.nextTemplateId).toBe(templateB.id);

        // Clean up
        sessionTemplates.delete(templateA.id);
        sessionTemplates.delete(templateB.id);
      });

      it('explicit null nextTemplateId clears templateId-derived value', async () => {
        const template = sessionTemplates.create({
          name: 'Template With Chain',
          prompt: 'Prompt',
          projectId,
          thinkingEnabled: true,
          gitBranch: 'feature/chain',
          gitMode: 'worktree',
        });

        const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
          prompt: 'Test prompt',
          templateId: template.id,
          nextTemplateId: null,
        });

        expect(res.status).toBe(201);

        const session = sessions.getById(res.body.id);
        // Template settings should be applied
        expect(session.thinkingEnabled).toBe(true);
        // But nextTemplateId should be null (explicitly cleared)
        expect(session.nextTemplateId).toBeNull();

        // Clean up
        sessionTemplates.delete(template.id);
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

  describe('GET /api/projects/:id/sessions with starred filter', () => {
    let session1Id;
    let session2Id;
    let session3Id;

    beforeEach(async () => {
      // Create multiple sessions with different starred states
      const session1 = sessions.create(projectId, 'Session 1', 'completed');
      const session2 = sessions.create(projectId, 'Session 2', 'completed');
      const session3 = sessions.create(projectId, 'Session 3', 'running');

      session1Id = session1.id;
      session2Id = session2.id;
      session3Id = session3.id;

      // Star session1
      sessions.update(session1Id, { starred: true });
    });

    it('returns all sessions when no starred filter is provided', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);

      const sessionIds = res.body.map((s) => s.id);
      expect(sessionIds).toContain(session1Id);
      expect(sessionIds).toContain(session2Id);
      expect(sessionIds).toContain(session3Id);
    });

    it('returns only starred sessions when starred=true', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions?starred=true`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(session1Id);
      expect(res.body[0].starred).toBe(true);
    });

    it('returns only non-starred sessions when starred=false', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions?starred=false`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const sessionIds = res.body.map((s) => s.id);
      expect(sessionIds).toContain(session2Id);
      expect(sessionIds).toContain(session3Id);
      expect(sessionIds).not.toContain(session1Id);

      // Verify all returned sessions are not starred
      res.body.forEach((s) => {
        expect(s.starred).toBe(false);
      });
    });

    it('combines archived and starred filters', async () => {
      // Create additional archived starred session
      const archivedStarred = sessions.create(projectId, 'Archived Starred', 'prompt');
      sessions.update(archivedStarred.id, { archived: true, starred: true });

      // Get non-archived starred sessions
      const res = await request(app).get(`/api/projects/${projectId}/sessions?archived=false&starred=true`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(session1Id);
      expect(res.body[0].archived).toBe(false);
      expect(res.body[0].starred).toBe(true);
    });

    it('starred sessions come first in result ordering', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions?archived=false`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);

      // First session should be the starred one
      expect(res.body[0].starred).toBe(true);
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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


    it('explicit param overrides project default', async () => {
      // Set project default
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        mode: 'plan',
      });

      // Create session with explicit mode
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        mode: 'standard',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        gitMode: 'worktree',
        gitBranch: 'test-branch',
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
        projectId,
        thinkingEnabled: true,
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        templateId: template.id,
        thinkingEnabled: false, // Param says false
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      // Template overrides param, so thinking should be true
      expect(session.thinkingEnabled).toBe(true);
    });

    it('uses system defaults when project has no defaults', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.mode).toBe('standard'); // System default
      expect(session.thinkingEnabled).toBe(false); // System default
      expect(session.status).toBe('starting'); // startImmediately default is true
    });

    it('applies project model default when no param provided', async () => {
      // Set project defaults with opus as the default model
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        model: 'opus',
      });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      // Session should have the project default model, not 'sonnet'
      expect(session.model).toBe('opus');
    });

    it('explicit model param overrides project model default', async () => {
      // Set project default to opus
      await request(app).post(`/api/projects/${projectId}/session-defaults`).send({
        model: 'opus',
      });

      // Create session with explicit model
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        model: 'haiku',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      expect(session.model).toBe('haiku'); // Param overrides default
    });

    it('session model is null when no project default and no param', async () => {
      // Don't set any project defaults - system default for model is null
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Test prompt',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      const session = sessions.getById(res.body.id);
      // System default for model is null - SDK decides
      expect(session.model).toBeNull();
    });
  });

  describe('child session git worktree inheritance', () => {
    it('inherits gitWorktree from parent session instead of calling setupGitForSession', async () => {
      // Create a parent session that has a gitWorktree
      const parentSession = sessions.create(projectId, 'Parent Session', 'running');
      sessions.update(parentSession.id, { gitWorktree: '/tmp/parent-worktree' });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Child prompt',
        parentSessionId: parentSession.id,
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      // setupGitForSession should NOT have been called because parent has a worktree
      expect(setupGitForSession).not.toHaveBeenCalled();

      // The child session should inherit the parent's gitWorktree
      const childSession = sessions.getById(res.body.id);
      expect(childSession.gitWorktree).toBe('/tmp/parent-worktree');
    });

    it('calls setupGitForSession when parent has no gitWorktree', async () => {
      // Create a parent session WITHOUT a gitWorktree
      const parentSession = sessions.create(projectId, 'Parent Session', 'running');
      sessions.update(parentSession.id, { gitWorktree: null });

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Child prompt',
        parentSessionId: parentSession.id,
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      // setupGitForSession SHOULD have been called because parent has no worktree
      expect(setupGitForSession).toHaveBeenCalledWith({
        projectDir: tempDir,
        gitMode: 'worktree',
        gitBranch: 'test-branch',
        sessionId: res.body.id,
      });
    });

    it('calls setupGitForSession when no parentSessionId is provided', async () => {
      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Standalone prompt',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      // setupGitForSession should be called for sessions without a parent
      expect(setupGitForSession).toHaveBeenCalledWith({
        projectDir: tempDir,
        gitMode: 'worktree',
        gitBranch: 'test-branch',
        sessionId: res.body.id,
      });
    });

    it('calls setupGitForSession when parent session has no gitWorktree field set', async () => {
      // Create a parent session that exists but has no gitWorktree at all (undefined/falsy)
      const parentSession = sessions.create(projectId, 'Parent No Worktree', 'running');
      // Don't set gitWorktree - it defaults to null

      const res = await request(app).post(`/api/projects/${projectId}/sessions`).send({
        prompt: 'Child of non-worktree parent',
        parentSessionId: parentSession.id,
        gitMode: 'worktree',
        gitBranch: 'test-branch',
      });

      expect(res.status).toBe(201);

      // setupGitForSession should be called because parent has no gitWorktree
      expect(setupGitForSession).toHaveBeenCalled();
    });
  });

  describe('GET /api/projects/:id/sessions with latestCommandRuns', () => {
    let session1Id;
    let session2Id;
    let buttonId;

    beforeEach(async () => {
      // Create sessions
      const session1 = sessions.create(projectId, 'Session 1', 'completed');
      const session2 = sessions.create(projectId, 'Session 2', 'completed');
      session1Id = session1.id;
      session2Id = session2.id;

      // Create a command button
      const button = commandButtons.create({
        projectId,
        label: 'Test Button',
        command: 'echo test',
        showOnList: true,
      });
      buttonId = button.id;
    });

    it('returns latestCommandRuns array in each session', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      // Each session should have latestCommandRuns property
      res.body.forEach((session) => {
        expect(Array.isArray(session.latestCommandRuns)).toBe(true);
      });
    });

    it('includes database runs in latestCommandRuns', async () => {
      // Create a completed run in the database
      const runId = crypto.randomUUID();
      commandRuns.create({ id: runId, sessionId: session1Id, buttonId });
      commandRuns.complete(runId, 0, 'output');

      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session1Response = res.body.find((s) => s.id === session1Id);
      expect(session1Response.latestCommandRuns).toBeDefined();
      expect(session1Response.latestCommandRuns.length).toBe(1);

      const run = session1Response.latestCommandRuns[0];
      expect(run.buttonId).toBe(buttonId);
      expect(run.status).toBe('success');
      expect(run.exitCode).toBe(0);
      expect(run.runId).toBeDefined();
    });

    it('returns empty latestCommandRuns for sessions without runs', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session2Response = res.body.find((s) => s.id === session2Id);
      expect(session2Response.latestCommandRuns).toEqual([]);
    });

    it('includes only latest run per button per session', async () => {
      // Create multiple runs for the same button and session
      const run1Id = crypto.randomUUID();
      commandRuns.create({ id: run1Id, sessionId: session1Id, buttonId });
      commandRuns.complete(run1Id, 0, 'output1');

      // Add a small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const run2Id = crypto.randomUUID();
      commandRuns.create({ id: run2Id, sessionId: session1Id, buttonId });
      commandRuns.complete(run2Id, 1, 'output2');

      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session1Response = res.body.find((s) => s.id === session1Id);

      // Should only include the latest run
      expect(session1Response.latestCommandRuns.length).toBe(1);
      expect(session1Response.latestCommandRuns[0].status).toBe('error');
      expect(session1Response.latestCommandRuns[0].exitCode).toBe(1);
    });

    it('merges runs from multiple buttons', async () => {
      // Create second button
      const button2 = commandButtons.create({
        projectId,
        label: 'Button 2',
        command: 'echo test2',
        showOnList: true,
      });

      // Create runs for both buttons
      const run1Id = crypto.randomUUID();
      commandRuns.create({ id: run1Id, sessionId: session1Id, buttonId });
      commandRuns.complete(run1Id, 0, 'output');

      const run2Id = crypto.randomUUID();
      commandRuns.create({ id: run2Id, sessionId: session1Id, buttonId: button2.id });
      commandRuns.complete(run2Id, 1, 'output');

      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session1Response = res.body.find((s) => s.id === session1Id);

      // Should include runs from both buttons
      expect(session1Response.latestCommandRuns.length).toBe(2);

      const buttonIds = session1Response.latestCommandRuns.map((r) => r.buttonId);
      expect(buttonIds).toContain(buttonId);
      expect(buttonIds).toContain(button2.id);
    });

    it('isolates runs by session', async () => {
      // Create runs for both sessions
      const run1Id = crypto.randomUUID();
      commandRuns.create({ id: run1Id, sessionId: session1Id, buttonId });
      commandRuns.complete(run1Id, 0, 'output1');

      const run2Id = crypto.randomUUID();
      commandRuns.create({ id: run2Id, sessionId: session2Id, buttonId });
      commandRuns.complete(run2Id, 1, 'output2');

      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session1Response = res.body.find((s) => s.id === session1Id);
      const session2Response = res.body.find((s) => s.id === session2Id);

      // Session 1 should have success run
      expect(session1Response.latestCommandRuns.length).toBe(1);
      expect(session1Response.latestCommandRuns[0].status).toBe('success');

      // Session 2 should have error run
      expect(session2Response.latestCommandRuns.length).toBe(1);
      expect(session2Response.latestCommandRuns[0].status).toBe('error');
    });

    it('includes required fields in latestCommandRuns', async () => {
      // Create a run
      const runId = crypto.randomUUID();
      commandRuns.create({ id: runId, sessionId: session1Id, buttonId });
      commandRuns.complete(runId, 0, 'output');

      const res = await request(app).get(`/api/projects/${projectId}/sessions`);

      expect(res.status).toBe(200);
      const session1Response = res.body.find((s) => s.id === session1Id);
      const run = session1Response.latestCommandRuns[0];

      // Verify required fields are present
      expect(run.buttonId).toBeDefined();
      expect(run.status).toBeDefined();
      expect(run.exitCode).toBeDefined();
      expect(run.runId).toBeDefined();
      expect(run.completedAt).toBeDefined();
    });

    it('respects archived filter with latestCommandRuns', async () => {
      // Archive one session
      sessions.update(session1Id, { archived: true });

      // Create a run for both sessions
      const run1Id = crypto.randomUUID();
      commandRuns.create({ id: run1Id, sessionId: session1Id, buttonId });
      commandRuns.complete(run1Id, 0, 'output');

      const run2Id = crypto.randomUUID();
      commandRuns.create({ id: run2Id, sessionId: session2Id, buttonId });
      commandRuns.complete(run2Id, 1, 'output');

      const res = await request(app).get(`/api/projects/${projectId}/sessions?archived=false`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(session2Id);

      // Should include the latestCommandRuns even with filter
      expect(res.body[0].latestCommandRuns).toBeDefined();
      expect(res.body[0].latestCommandRuns.length).toBe(1);
    });
  });
});
