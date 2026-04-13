import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock hookService
vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

import archiveRouter from './sessions-archive.js';
import { broadcastToProject } from '../websocket.js';
import { executeHookAsync } from '../services/hookService.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

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
      projects.update(project.id, { onSessionDeleted: './cleanup.sh' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/archive`)
        .send({ cleanup: false });

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

      const childSession = sessions.create(project.id, 'Child Session', 'child prompt');
      sessions.update(childSession.id, {
        status: 'stopped',
        gitWorktree: '/path/to/wt',
        parentSessionId: parentSession.id,
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
