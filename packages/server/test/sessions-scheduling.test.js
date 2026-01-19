import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../src/database.js';

// Mock websocket
vi.mock('../src/websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

// Import after mocking
import sessionsRouter from '../src/api/sessions.js';
import { broadcastToProject, broadcastToSession } from '../src/websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

describe('Sessions API - Scheduling Endpoints', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  describe('GET /api/sessions/scheduled', () => {
    it('returns empty array when no sessions are scheduled', async () => {
      const res = await request(app)
        .get('/api/sessions/scheduled')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('returns scheduled sessions', async () => {
      const scheduledAt = Date.now() + 3600000; // 1 hour from now
      sessions.update(session.id, {
        status: 'scheduled',
        scheduledAt,
      });

      const res = await request(app)
        .get('/api/sessions/scheduled')
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(session.id);
      expect(res.body[0].status).toBe('scheduled');
      expect(res.body[0].scheduledAt).toBe(scheduledAt);
    });

    it('returns multiple scheduled sessions', async () => {
      // Create another project and sessions
      const project2 = projects.create('Project 2', '/tmp/test2');
      const session2 = sessions.create(project2.id, 'Session 2', 'Prompt 2');

      // Schedule both sessions
      const scheduledAt1 = Date.now() + 1800000;
      const scheduledAt2 = Date.now() + 3600000;

      sessions.update(session.id, { status: 'scheduled', scheduledAt: scheduledAt1 });
      sessions.update(session2.id, { status: 'scheduled', scheduledAt: scheduledAt2 });

      const res = await request(app)
        .get('/api/sessions/scheduled')
        .expect(200);

      expect(res.body.length).toBe(2);
      const ids = res.body.map((s) => s.id);
      expect(ids).toContain(session.id);
      expect(ids).toContain(session2.id);
    });

    it('does not return non-scheduled sessions', async () => {
      // Create multiple sessions with different statuses
      sessions.update(session.id, { status: 'running' });
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt 2');
      sessions.update(session2.id, { status: 'completed' });

      const res = await request(app)
        .get('/api/sessions/scheduled')
        .expect(200);

      expect(res.body.length).toBe(0);
    });

    it('includes project name in scheduled sessions', async () => {
      const scheduledAt = Date.now() + 3600000;
      sessions.update(session.id, { status: 'scheduled', scheduledAt });

      const res = await request(app)
        .get('/api/sessions/scheduled')
        .expect(200);

      expect(res.body[0].projectName).toBe(project.name);
    });

    it('filters scheduled sessions by projectId query parameter', async () => {
      // Create another project and scheduled session
      const project2 = projects.create('Project 2', '/tmp/test2');
      const session2 = sessions.create(project2.id, 'Session 2', 'Prompt 2');
      const scheduledAt2 = Date.now() + 3600000;
      sessions.update(session2.id, { status: 'scheduled', scheduledAt: scheduledAt2 });

      // Schedule current project's session too
      const scheduledAt1 = Date.now() + 1800000;
      sessions.update(session.id, { status: 'scheduled', scheduledAt: scheduledAt1 });

      // Request with projectId filter
      const res = await request(app)
        .get(`/api/sessions/scheduled?projectId=${project.id}`)
        .expect(200);

      // Should only return sessions from the specified project
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(session.id);
      expect(res.body[0].projectId).toBe(project.id);
      expect(res.body[0].projectName).toBe(project.name);
    });

    it('returns empty array when filtering by projectId with no scheduled sessions', async () => {
      // Create another project without scheduled sessions
      const project2 = projects.create('Project 2', '/tmp/test2');

      // Schedule a session in the first project
      const scheduledAt = Date.now() + 3600000;
      sessions.update(session.id, { status: 'scheduled', scheduledAt });

      // Request with second project's ID
      const res = await request(app)
        .get(`/api/sessions/scheduled?projectId=${project2.id}`)
        .expect(200);

      // Should return empty array
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('ignores invalid projectId and returns all scheduled sessions', async () => {
      const scheduledAt = Date.now() + 3600000;
      sessions.update(session.id, { status: 'scheduled', scheduledAt });

      const res = await request(app)
        .get('/api/sessions/scheduled?projectId=nonexistent-id')
        .expect(200);

      // Should return empty array when filtering by non-existent project
      expect(res.body).toHaveLength(0);
    });
  });

  describe('PATCH /api/sessions/:id - Scheduling fields', () => {
    it('updates scheduledAt field', async () => {
      const scheduledAt = Date.now() + 3600000;

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt, status: 'scheduled' })
        .expect(200);

      expect(res.body.scheduledAt).toBe(scheduledAt);
      expect(res.body.status).toBe('scheduled');
    });

    it('clears scheduledAt when set to null', async () => {
      // First set it
      sessions.update(session.id, { status: 'scheduled', scheduledAt: Date.now() });

      // Then clear it
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt: null })
        .expect(200);

      expect(res.body.scheduledAt).toBeNull();
    });

    it('updates autoRescheduleEnabled', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ autoRescheduleEnabled: true })
        .expect(200);

      expect(res.body.autoRescheduleEnabled).toBe(true);
    });

    it('updates rescheduleDelayMinutes', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ rescheduleDelayMinutes: 30 })
        .expect(200);

      expect(res.body.rescheduleDelayMinutes).toBe(30);
    });

    it('updates reschedule trigger flags', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          rescheduleOnTokenLimit: false,
          rescheduleOnServiceError: true,
        })
        .expect(200);

      expect(res.body.rescheduleOnTokenLimit).toBe(false);
      expect(res.body.rescheduleOnServiceError).toBe(true);
    });

    it('updates maxRescheduleCount', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ maxRescheduleCount: 5 })
        .expect(200);

      expect(res.body.maxRescheduleCount).toBe(5);
    });

    it('allows clearing maxRescheduleCount by setting to null', async () => {
      // First set it
      sessions.update(session.id, { maxRescheduleCount: 5 });

      // Then clear it
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ maxRescheduleCount: null })
        .expect(200);

      expect(res.body.maxRescheduleCount).toBeNull();
    });

    it('updates maxTotalTokens', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ maxTotalTokens: 500000 })
        .expect(200);

      expect(res.body.maxTotalTokens).toBe(500000);
    });

    it('updates rescheduleAtTokenCount', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ rescheduleAtTokenCount: 300000 })
        .expect(200);

      expect(res.body.rescheduleAtTokenCount).toBe(300000);
    });

    it('updates rescheduleCount for resetting', async () => {
      // Set initial count
      sessions.update(session.id, { rescheduleCount: 5 });

      // Reset it
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ rescheduleCount: 0 })
        .expect(200);

      expect(res.body.rescheduleCount).toBe(0);
    });

    it('allows updating multiple scheduling fields at once', async () => {
      const scheduledAt = Date.now() + 3600000;

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          status: 'scheduled',
          scheduledAt,
          autoRescheduleEnabled: true,
          rescheduleDelayMinutes: 15,
          maxRescheduleCount: 10,
          rescheduleOnTokenLimit: true,
        })
        .expect(200);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.scheduledAt).toBe(scheduledAt);
      expect(res.body.autoRescheduleEnabled).toBe(true);
      expect(res.body.rescheduleDelayMinutes).toBe(15);
      expect(res.body.maxRescheduleCount).toBe(10);
      expect(res.body.rescheduleOnTokenLimit).toBe(true);
    });

    it('broadcasts SESSION_UPDATED when scheduling fields change', async () => {
      const scheduledAt = Date.now() + 3600000;

      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ scheduledAt, status: 'scheduled' })
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalled();
      const call = broadcastToProject.mock.calls[0];
      expect(call[0]).toBe(project.id);
      expect(call[1]).toBe(WS_MESSAGE_TYPES.SESSION_UPDATED);
      expect(call[2].session.scheduledAt).toBe(scheduledAt);
    });

    it('allows updating scheduled status', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ status: 'scheduled' })
        .expect(200);

      expect(res.body.status).toBe('scheduled');
    });

    it('rejects invalid status values', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ status: 'invalid-status' })
        .expect(400);

      expect(res.body.error).toBe('Invalid status');
    });

    it('preserves other fields when updating scheduling fields', async () => {
      const originalName = session.name;
      const originalProjectId = session.projectId;

      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ autoRescheduleEnabled: true })
        .expect(200);

      const updated = sessions.getById(session.id);
      expect(updated.name).toBe(originalName);
      expect(updated.projectId).toBe(originalProjectId);
    });

    it('handles numeric string input for numeric fields', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          rescheduleDelayMinutes: '30',
          maxRescheduleCount: '5',
        })
        .expect(200);

      expect(res.body.rescheduleDelayMinutes).toBe(30);
      expect(res.body.maxRescheduleCount).toBe(5);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .patch('/api/sessions/non-existent-id')
        .send({ autoRescheduleEnabled: true })
        .expect(404);

      expect(res.body.error).toBe('Session not found');
    });

    it('requires at least one field to update', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({})
        .expect(400);

      expect(res.body.error).toBe('No valid fields to update');
    });
  });

  describe('status field validation with scheduling', () => {
    it('allows scheduled status along with other scheduling fields', async () => {
      const scheduledAt = Date.now() + 3600000;

      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          status: 'scheduled',
          scheduledAt,
        })
        .expect(200);

      expect(res.body.status).toBe('scheduled');
      expect(res.body.scheduledAt).toBe(scheduledAt);
    });

    it('allows all valid status values including scheduled', async () => {
      const validStatuses = ['starting', 'running', 'waiting', 'error', 'stopped', 'scheduled'];

      for (const status of validStatuses) {
        const res = await request(app)
          .patch(`/api/sessions/${session.id}`)
          .send({ status })
          .expect(200);

        expect(res.body.status).toBe(status);
      }
    });
  });

  describe('scheduling with rescheduling', () => {
    it('creates a complete reschedule scenario', async () => {
      const res = await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({
          status: 'scheduled',
          scheduledAt: Date.now() + 3600000,
          autoRescheduleEnabled: true,
          rescheduleDelayMinutes: 15,
          rescheduleOnTokenLimit: true,
          rescheduleOnServiceError: true,
          maxRescheduleCount: 5,
          maxTotalTokens: 500000,
          rescheduleAtTokenCount: 300000,
        })
        .expect(200);

      const body = res.body;
      expect(body.status).toBe('scheduled');
      expect(body.autoRescheduleEnabled).toBe(true);
      expect(body.rescheduleDelayMinutes).toBe(15);
      expect(body.rescheduleOnTokenLimit).toBe(true);
      expect(body.rescheduleOnServiceError).toBe(true);
      expect(body.maxRescheduleCount).toBe(5);
      expect(body.maxTotalTokens).toBe(500000);
      expect(body.rescheduleAtTokenCount).toBe(300000);
    });

    it('includes all scheduling fields in response', async () => {
      const res = await request(app)
        .get(`/api/sessions/${session.id}`)
        .expect(200);

      // Check that response includes all scheduling fields
      expect(res.body).toHaveProperty('scheduledAt');
      expect(res.body).toHaveProperty('autoRescheduleEnabled');
      expect(res.body).toHaveProperty('rescheduleDelayMinutes');
      expect(res.body).toHaveProperty('rescheduleOnTokenLimit');
      expect(res.body).toHaveProperty('rescheduleOnServiceError');
      expect(res.body).toHaveProperty('maxRescheduleCount');
      expect(res.body).toHaveProperty('maxTotalTokens');
      expect(res.body).toHaveProperty('rescheduleCount');
      expect(res.body).toHaveProperty('rescheduleAtTokenCount');
    });
  });
});
