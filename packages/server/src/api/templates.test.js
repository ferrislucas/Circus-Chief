import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import templatesRouter from './templates.js';
import { projects, sessionTemplates } from '../database.js';

describe('Templates API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/templates', templatesRouter);
  });

  describe('GET /api/templates', () => {
    it('returns empty array when no global templates exist', async () => {
      const res = await request(app).get('/api/templates');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns only global templates', async () => {
      const project = projects.create('Test Project', '/tmp/test');
      sessionTemplates.create({ projectId: null, name: 'Global 1', prompt: 'Prompt 1' });
      sessionTemplates.create({ projectId: null, name: 'Global 2', prompt: 'Prompt 2' });
      sessionTemplates.create({ projectId: project.id, name: 'Project Template', prompt: 'Prompt 3' });

      const res = await request(app).get('/api/templates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((t) => t.projectId === null)).toBe(true);
    });
  });

  describe('POST /api/templates', () => {
    it('creates a global template', async () => {
      const res = await request(app).post('/api/templates').send({
        name: 'New Template',
        prompt: 'Do something',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.projectId).toBeNull();
      expect(res.body.name).toBe('New Template');
      expect(res.body.prompt).toBe('Do something');
    });

    it('creates template with all optional fields', async () => {
      const otherTemplate = sessionTemplates.create({
        projectId: null,
        name: 'Other',
        prompt: 'Other prompt',
      });

      const res = await request(app).post('/api/templates').send({
        name: 'Full Template',
        prompt: 'Full prompt',
        nextTemplateId: otherTemplate.id,
        thinkingEnabled: true,
        gitBranch: 'feature-branch',
        gitMode: 'worktree',
        model: 'claude-sonnet-4-20250514',
        mode: 'plan',
      });

      expect(res.status).toBe(201);
      expect(res.body.nextTemplateId).toBe(otherTemplate.id);
      expect(res.body.thinkingEnabled).toBe(true);
      expect(res.body.gitBranch).toBe('feature-branch');
      expect(res.body.gitMode).toBe('worktree');
      expect(res.body.model).toBe('claude-sonnet-4-20250514');
      expect(res.body.mode).toBe('plan');
    });

    it('returns 400 for missing name', async () => {
      const res = await request(app).post('/api/templates').send({
        prompt: 'Some prompt',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing prompt', async () => {
      const res = await request(app).post('/api/templates').send({
        name: 'Template Name',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/templates/:id', () => {
    it('returns template by ID', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Test Template',
        prompt: 'Test prompt',
      });

      const res = await request(app).get(`/api/templates/${template.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(template.id);
      expect(res.body.name).toBe('Test Template');
    });

    it('returns 404 for non-existent template', async () => {
      const res = await request(app).get('/api/templates/non-existent-id');

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/templates/:id', () => {
    it('updates template name', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Original',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        name: 'Updated',
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('updates template prompt', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Original prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        prompt: 'New prompt',
      });

      expect(res.status).toBe(200);
      expect(res.body.prompt).toBe('New prompt');
    });

    it('updates nextTemplateId', async () => {
      const nextTemplate = sessionTemplates.create({
        projectId: null,
        name: 'Next',
        prompt: 'Next prompt',
      });
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        nextTemplateId: nextTemplate.id,
      });

      expect(res.status).toBe(200);
      expect(res.body.nextTemplateId).toBe(nextTemplate.id);
    });

    it('returns 404 for non-existent template', async () => {
      const res = await request(app).patch('/api/templates/non-existent-id').send({
        name: 'Updated',
      });

      expect(res.status).toBe(404);
    });

    it('updates model field', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        model: 'claude-opus-4-20250514',
      });

      expect(res.status).toBe(200);
      expect(res.body.model).toBe('claude-opus-4-20250514');
    });

    it('updates mode field', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        mode: 'standard',
      });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('standard');
    });

    it('updates gitBranch field', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        gitBranch: 'feature/new-feature',
      });

      expect(res.status).toBe(200);
      expect(res.body.gitBranch).toBe('feature/new-feature');
    });

    it('updates gitMode field', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        gitMode: 'branch',
      });

      expect(res.status).toBe(200);
      expect(res.body.gitMode).toBe('branch');
    });

    it('updates all new fields together', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });

      const res = await request(app).patch(`/api/templates/${template.id}`).send({
        model: 'claude-sonnet-4-20250514',
        mode: 'plan',
        gitBranch: 'develop',
        gitMode: 'worktree',
      });

      expect(res.status).toBe(200);
      expect(res.body.model).toBe('claude-sonnet-4-20250514');
      expect(res.body.mode).toBe('plan');
      expect(res.body.gitBranch).toBe('develop');
      expect(res.body.gitMode).toBe('worktree');
    });
  });

  describe('DELETE /api/templates/:id', () => {
    it('deletes a template', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'To Delete',
        prompt: 'Prompt',
      });

      const res = await request(app).delete(`/api/templates/${template.id}`);

      expect(res.status).toBe(204);
      expect(sessionTemplates.getById(template.id)).toBeNull();
    });

    it('returns 404 for non-existent template', async () => {
      const res = await request(app).delete('/api/templates/non-existent-id');

      expect(res.status).toBe(404);
    });
  });
});
