import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import projectsRouter from '../src/api/projects.js';
import sessionsRouter from '../src/api/sessions.js';
import { projects, sessions, sessionTemplates } from '../src/database.js';

describe('Session Templates Integration', () => {
  let app;
  let project;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
  });

  describe('GET /api/projects/:id/templates', () => {
    it('returns empty arrays when no templates exist', async () => {
      const res = await request(app).get(`/api/projects/${project.id}/templates`);

      expect(res.status).toBe(200);
      expect(res.body.project).toEqual([]);
      expect(res.body.global).toEqual([]);
    });

    it('returns project and global templates separately', async () => {
      sessionTemplates.create({ projectId: null, name: 'Global 1', prompt: 'Prompt' });
      sessionTemplates.create({ projectId: project.id, name: 'Project 1', prompt: 'Prompt' });

      const res = await request(app).get(`/api/projects/${project.id}/templates`);

      expect(res.status).toBe(200);
      expect(res.body.project).toHaveLength(1);
      expect(res.body.global).toHaveLength(1);
      expect(res.body.project[0].name).toBe('Project 1');
      expect(res.body.global[0].name).toBe('Global 1');
    });

  });

  describe('POST /api/projects/:id/templates', () => {
    it('creates a project template', async () => {
      const res = await request(app).post(`/api/projects/${project.id}/templates`).send({
        name: 'Project Template',
        prompt: 'Do something for this project',
      });

      expect(res.status).toBe(201);
      expect(res.body.projectId).toBe(project.id);
      expect(res.body.name).toBe('Project Template');
    });

    it('returns 404 for non-existent project', async () => {
      const res = await request(app).post('/api/projects/non-existent/templates').send({
        name: 'Template',
        prompt: 'Prompt',
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid data', async () => {
      const res = await request(app).post(`/api/projects/${project.id}/templates`).send({
        name: 'Template',
        // missing prompt
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/sessions/:id (nextTemplateId)', () => {
    it('sets nextTemplateId on a session', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Review Template',
        prompt: 'Review the work',
      });
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt');

      const res = await request(app).patch(`/api/sessions/${session.id}`).send({
        nextTemplateId: template.id,
      });

      expect(res.status).toBe(200);
      expect(res.body.nextTemplateId).toBe(template.id);
    });

    it('clears nextTemplateId when set to null', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt');
      sessions.update(session.id, { nextTemplateId: template.id });

      const res = await request(app).patch(`/api/sessions/${session.id}`).send({
        nextTemplateId: null,
      });

      expect(res.status).toBe(200);
      expect(res.body.nextTemplateId).toBeNull();
    });

    it('returns 400 for non-existent template', async () => {
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt');

      const res = await request(app).patch(`/api/sessions/${session.id}`).send({
        nextTemplateId: 'non-existent-template-id',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Template not found');
    });
  });

  describe('Session with template fields', () => {
    it('session includes nextTemplateId in response', async () => {
      const template = sessionTemplates.create({
        projectId: null,
        name: 'Template',
        prompt: 'Prompt',
      });
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt');
      sessions.update(session.id, { nextTemplateId: template.id });

      const res = await request(app).get(`/api/sessions/${session.id}`);

      expect(res.status).toBe(200);
      expect(res.body.nextTemplateId).toBe(template.id);
    });

    it('session includes parentSessionId in response', async () => {
      const parentSession = sessions.create(project.id, 'Parent', 'Parent prompt');
      const childSession = sessions.create(project.id, 'Child', 'Child prompt');
      sessions.update(childSession.id, { parentSessionId: parentSession.id });

      const res = await request(app).get(`/api/sessions/${childSession.id}`);

      expect(res.status).toBe(200);
      expect(res.body.parentSessionId).toBe(parentSession.id);
    });
  });
});
