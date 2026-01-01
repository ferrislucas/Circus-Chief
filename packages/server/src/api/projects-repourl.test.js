import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { projects } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({ workingDirectory: '/tmp/test', gitWorktree: null }),
}));

// Import after mocks are set up
import projectsRouter from './projects.js';

describe('Projects API - Repository URL', () => {
  let app;
  let tempDir;
  let projectId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);

    // Create temp directory for project
    tempDir = mkdtempSync(join(tmpdir(), 'projects-repourl-test-'));

    // Initialize as git repo
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    execSync('touch test.txt && git add . && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });

    // Create project
    const project = projects.create('Test Project', tempDir);
    projectId = project.id;
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('PUT /api/projects/:id with repoUrl', () => {
    it('updates project with repoUrl', async () => {
      const repoUrl = 'https://github.com/example/repo';

      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: 'Test Project',
          workingDirectory: tempDir,
          repoUrl: repoUrl,
        });

      expect(res.status).toBe(200);
      expect(res.body.repoUrl).toBe(repoUrl);

      // Verify it was persisted
      const updated = projects.getById(projectId);
      expect(updated.repoUrl).toBe(repoUrl);
    });

    it('sets repoUrl to null when clearing', async () => {
      // First set a URL
      projects.update(projectId, {
        repoUrl: 'https://github.com/example/repo',
      });

      // Then clear it
      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: 'Test Project',
          workingDirectory: tempDir,
          repoUrl: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.repoUrl).toBeNull();
    });

    it('accepts different GitHub URLs', async () => {
      const testUrls = [
        'https://github.com/user/repo',
        'https://github.com/user/repo-with-dashes',
        'https://gitlab.com/group/project',
        'https://gitea.example.com/org/repo',
      ];

      for (const url of testUrls) {
        const res = await request(app)
          .put(`/api/projects/${projectId}`)
          .send({
            name: 'Test Project',
            workingDirectory: tempDir,
            repoUrl: url,
          });

        expect(res.status).toBe(200);
        expect(res.body.repoUrl).toBe(url);
      }
    });

    it('rejects invalid URLs', async () => {
      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: 'Test Project',
          workingDirectory: tempDir,
          repoUrl: 'not-a-valid-url',
        });

      expect(res.status).toBe(400);
    });

    it('keeps repoUrl when not provided in update', async () => {
      const repoUrl = 'https://github.com/example/repo';
      projects.update(projectId, { repoUrl });

      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: 'Updated Name',
          workingDirectory: tempDir,
        });

      expect(res.status).toBe(200);
      expect(res.body.repoUrl).toBe(repoUrl);
    });

    it('updates repoUrl alongside other fields', async () => {
      const newName = 'New Project Name';
      const newUrl = 'https://github.com/new/repo';

      const res = await request(app)
        .put(`/api/projects/${projectId}`)
        .send({
          name: newName,
          workingDirectory: tempDir,
          repoUrl: newUrl,
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(newName);
      expect(res.body.repoUrl).toBe(newUrl);
    });
  });

  describe('GET /api/projects/:id with repoUrl', () => {
    it('returns repoUrl in project details', async () => {
      const repoUrl = 'https://github.com/example/repo';
      projects.update(projectId, { repoUrl });

      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.repoUrl).toBe(repoUrl);
    });

    it('returns null repoUrl when not set', async () => {
      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.repoUrl).toBeNull();
    });
  });

  describe('GET /api/projects with repoUrl', () => {
    it('includes repoUrl in project list', async () => {
      const repoUrl = 'https://github.com/example/repo';
      projects.update(projectId, { repoUrl });

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const project = res.body.find((p) => p.id === projectId);
      expect(project).toBeDefined();
      expect(project.repoUrl).toBe(repoUrl);
    });
  });
});
