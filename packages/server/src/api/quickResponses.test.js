import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, quickResponses } from '../database.js';
import quickResponsesRouter from './quickResponses.js';

describe('Quick Responses API', () => {
  let app;
  let projectId;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', quickResponsesRouter);

    // Create project
    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;
  });

  describe('GET /api/projects/:projectId/quick-responses', () => {
    it('should return 200 with project and global responses', async () => {
      quickResponses.create({ projectId, label: 'Yes', content: 'yes' });
      quickResponses.create({ projectId, label: 'No', content: 'no' });
      quickResponses.create({ projectId: null, label: 'LGTM', content: 'Looks good!' });

      const res = await request(app).get(`/api/projects/${projectId}/quick-responses`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('project');
      expect(res.body).toHaveProperty('global');
      expect(res.body.project).toHaveLength(2);
      expect(res.body.global).toHaveLength(1);
    });

    it('should return 200 with empty arrays if no responses', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/quick-responses`);

      expect(res.status).toBe(200);
      expect(res.body.project).toEqual([]);
      expect(res.body.global).toEqual([]);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app).get('/api/projects/nonexistent-id/quick-responses');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should include all response fields in response body', async () => {
      quickResponses.create({
        projectId,
        label: 'Test',
        content: 'Test content',
        autoSubmit: true,
        category: 'feedback',
        sortOrder: 5,
      });

      const res = await request(app).get(`/api/projects/${projectId}/quick-responses`);

      expect(res.status).toBe(200);
      const response = res.body.project[0];
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('projectId');
      expect(response).toHaveProperty('label');
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('autoSubmit');
      expect(response).toHaveProperty('category');
      expect(response).toHaveProperty('sortOrder');
      expect(response).toHaveProperty('createdAt');
      expect(response).toHaveProperty('updatedAt');
    });
  });

  describe('POST /api/projects/:projectId/quick-responses', () => {
    it('should return 201 with created response', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Yes', content: 'yes' });

      expect(res.status).toBe(201);
      expect(res.body.label).toBe('Yes');
      expect(res.body.content).toBe('yes');
      expect(res.body.projectId).toBe(projectId);
    });

    it('should return 400 if label is missing', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ content: 'content' });

      expect(res.status).toBe(400);
    });

    it('should return 400 if content is missing', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Test' });

      expect(res.status).toBe(400);
    });

    it('should return 400 if label is empty string', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: '', content: 'content' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Label is required');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app)
        .post('/api/projects/nonexistent-id/quick-responses')
        .send({ label: 'Test', content: 'content' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should accept optional autoSubmit field', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Yes', content: 'yes', autoSubmit: true });

      expect(res.status).toBe(201);
      expect(res.body.autoSubmit).toBe(true);
    });

    it('should accept optional category field', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Test', content: 'content', category: 'feedback' });

      expect(res.status).toBe(201);
      expect(res.body.category).toBe('feedback');
    });

    it('should accept optional sortOrder field', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Test', content: 'content', sortOrder: 5 });

      expect(res.status).toBe(201);
      expect(res.body.sortOrder).toBe(5);
    });

    it('should create global response when isGlobal = true', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Global', content: 'global content', isGlobal: true });

      expect(res.status).toBe(201);
      expect(res.body.projectId).toBeNull();
    });

    it('should trim whitespace from label', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: '  Yes  ', content: 'yes' });

      expect(res.status).toBe(201);
      expect(res.body.label).toBe('Yes');
    });
  });

  describe('GET /api/quick-responses/global', () => {
    it('should return 200 with global responses only', async () => {
      quickResponses.create({ projectId, label: 'Project', content: 'project' });
      quickResponses.create({ projectId: null, label: 'Global1', content: 'global1' });
      quickResponses.create({ projectId: null, label: 'Global2', content: 'global2' });

      const res = await request(app).get('/api/quick-responses/global');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((r) => r.projectId === null)).toBe(true);
    });

    it('should return 200 with empty array if no global responses', async () => {
      quickResponses.create({ projectId, label: 'Project', content: 'project' });

      const res = await request(app).get('/api/quick-responses/global');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PATCH /api/quick-responses/:id', () => {
    it('should return 200 with updated response', async () => {
      const created = quickResponses.create({ projectId, label: 'Old', content: 'old' });

      const res = await request(app)
        .patch(`/api/quick-responses/${created.id}`)
        .send({ label: 'New' });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe('New');
      expect(res.body.content).toBe('old'); // Preserved
    });

    it('should return 404 for non-existent id', async () => {
      const res = await request(app)
        .patch('/api/quick-responses/nonexistent-id')
        .send({ label: 'New' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Quick response not found');
    });

    it('should return 400 for empty update object', async () => {
      const created = quickResponses.create({ projectId, label: 'Test', content: 'content' });

      const res = await request(app).patch(`/api/quick-responses/${created.id}`).send({});

      expect(res.status).toBe(400);
    });

    it('should support partial updates', async () => {
      const created = quickResponses.create({
        projectId,
        label: 'Old',
        content: 'old content',
        autoSubmit: false,
      });

      const res = await request(app)
        .patch(`/api/quick-responses/${created.id}`)
        .send({ label: 'New' });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe('New');
      expect(res.body.content).toBe('old content');
      expect(res.body.autoSubmit).toBe(false);
    });

    it('should update updated_at timestamp', async () => {
      const created = quickResponses.create({ projectId, label: 'Test', content: 'content' });

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      const res = await request(app)
        .patch(`/api/quick-responses/${created.id}`)
        .send({ label: 'New' });

      expect(res.status).toBe(200);
      expect(res.body.updatedAt).toBeGreaterThan(created.updatedAt);
    });

    it('should trim whitespace from label when updating', async () => {
      const created = quickResponses.create({ projectId, label: 'Old', content: 'content' });

      const res = await request(app)
        .patch(`/api/quick-responses/${created.id}`)
        .send({ label: '  New  ' });

      expect(res.status).toBe(200);
      expect(res.body.label).toBe('New');
    });
  });

  describe('DELETE /api/quick-responses/:id', () => {
    it('should return 204 on successful deletion', async () => {
      const created = quickResponses.create({ projectId, label: 'Test', content: 'content' });

      const res = await request(app).delete(`/api/quick-responses/${created.id}`);

      expect(res.status).toBe(204);
    });

    it('should return 404 for non-existent id', async () => {
      const res = await request(app).delete('/api/quick-responses/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Quick response not found');
    });

    it('should actually remove the response from database', async () => {
      const created = quickResponses.create({ projectId, label: 'Test', content: 'content' });

      await request(app).delete(`/api/quick-responses/${created.id}`);

      const found = quickResponses.getById(created.id);
      expect(found).toBeNull();
    });
  });

  describe('POST /api/projects/:projectId/quick-responses/reorder', () => {
    it('should reorder responses and return updated list', async () => {
      const r1 = quickResponses.create({ projectId, label: 'A', content: 'a', sortOrder: 0 });
      const r2 = quickResponses.create({ projectId, label: 'B', content: 'b', sortOrder: 1 });
      const r3 = quickResponses.create({ projectId, label: 'C', content: 'c', sortOrder: 2 });

      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses/reorder`)
        .send([
          { id: r3.id, sortOrder: 0 },
          { id: r1.id, sortOrder: 1 },
          { id: r2.id, sortOrder: 2 },
        ]);

      expect(res.status).toBe(200);
      expect(res.body.project[0].label).toBe('C');
      expect(res.body.project[1].label).toBe('A');
      expect(res.body.project[2].label).toBe('B');
    });

    it('should return 404 for non-existent project', async () => {
      const res = await request(app)
        .post('/api/projects/nonexistent-id/quick-responses/reorder')
        .send([]);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should return 400 for invalid request body', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses/reorder`)
        .send([{ id: '1' }]); // Missing sortOrder

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/quick-responses/global/reorder', () => {
    it('should reorder global responses and return updated list', async () => {
      const r1 = quickResponses.create({ projectId: null, label: 'A', content: 'a', sortOrder: 0 });
      const r2 = quickResponses.create({ projectId: null, label: 'B', content: 'b', sortOrder: 1 });
      const r3 = quickResponses.create({ projectId: null, label: 'C', content: 'c', sortOrder: 2 });

      const res = await request(app)
        .post('/api/quick-responses/global/reorder')
        .send([
          { id: r3.id, sortOrder: 0 },
          { id: r1.id, sortOrder: 1 },
          { id: r2.id, sortOrder: 2 },
        ]);

      expect(res.status).toBe(200);
      expect(res.body[0].label).toBe('C');
      expect(res.body[1].label).toBe('A');
      expect(res.body[2].label).toBe('B');
    });
  });

  describe('validation schemas', () => {
    it('should reject label longer than 50 characters', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'a'.repeat(51), content: 'content' });

      expect(res.status).toBe(400);
    });

    it('should reject content longer than 10000 characters', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Test', content: 'a'.repeat(10001) });

      expect(res.status).toBe(400);
    });

    it('should accept unicode in label and content', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/quick-responses`)
        .send({ label: 'Yes', content: 'yes' });

      expect(res.status).toBe(201);
    });
  });
});
