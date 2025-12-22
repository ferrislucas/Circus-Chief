import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../src/database.js';

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock the session manager to avoid starting actual sessions
vi.mock('../src/services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock git setup
vi.mock('../src/services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

// Mock git service
vi.mock('../src/services/gitService.js', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock summary service
vi.mock('../src/services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  regenerateSummary: vi.fn().mockResolvedValue(null),
  cleanupSession: vi.fn(),
}));

// Mock hook service
vi.mock('../src/services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Import after mocking
import { broadcastToSession, broadcastToProject } from '../src/websocket.js';
import sessionsRouter from '../src/api/sessions.js';
import projectsRouter from '../src/api/projects.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

describe('API Broadcast Tests', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test Express app
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
    app.use('/api/projects', projectsRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
  });

  describe('POST /api/projects/:id/sessions', () => {
    it('broadcasts SESSION_CREATED to project subscribers', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .send({ prompt: 'Create a new feature' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_CREATED,
        expect.objectContaining({
          projectId: project.id,
          session: expect.objectContaining({
            id: response.body.id,
            projectId: project.id,
          }),
        })
      );
    });

    it('includes full session data in SESSION_CREATED broadcast', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .send({ prompt: 'Test prompt', name: 'Custom Name' })
        .expect(201);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_CREATED,
        expect.objectContaining({
          session: expect.objectContaining({
            name: 'Custom Name',
            status: 'starting',
          }),
        })
      );
    });
  });

  describe('PATCH /api/sessions/:id', () => {
    it('broadcasts SESSION_UPDATED to project subscribers when status changes', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ status: 'running' })
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          projectId: project.id,
          sessionId: session.id,
          session: expect.objectContaining({
            status: 'running',
          }),
        })
      );
    });

    it('broadcasts SESSION_STATUS to session subscribers when status changes', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ status: 'waiting' })
        .expect(200);

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_STATUS,
        expect.objectContaining({
          sessionId: session.id,
          status: 'waiting',
        })
      );
    });

    it('broadcasts SESSION_UPDATED when mode changes', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ mode: 'yolo' })
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          session: expect.objectContaining({
            mode: 'yolo',
          }),
        })
      );
    });

    it('broadcasts SESSION_UPDATED when thinkingEnabled changes', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ thinkingEnabled: true })
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          session: expect.objectContaining({
            thinkingEnabled: true,
          }),
        })
      );
    });

    it('does not broadcast SESSION_STATUS when only mode changes (not status)', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ mode: 'plan' })
        .expect(200);

      // broadcastToSession should not be called with SESSION_STATUS
      expect(broadcastToSession).not.toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_STATUS,
        expect.anything()
      );

      // But broadcastToProject should still be called
      expect(broadcastToProject).toHaveBeenCalled();
    });

    it('broadcasts SESSION_UPDATED when model changes', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: 'claude-opus-4-5-20251101' })
        .expect(200);

      expect(broadcastToProject).toHaveBeenCalledWith(
        project.id,
        WS_MESSAGE_TYPES.SESSION_UPDATED,
        expect.objectContaining({
          session: expect.objectContaining({
            model: 'claude-opus-4-5-20251101',
          }),
        })
      );
    });

    it('returns 400 for invalid model', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ model: 'invalid-model' })
        .expect(400);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('broadcasts SESSION_DELETED to session subscribers', async () => {
      await request(app)
        .delete(`/api/sessions/${session.id}`)
        .expect(204);

      expect(broadcastToSession).toHaveBeenCalledWith(
        session.id,
        WS_MESSAGE_TYPES.SESSION_DELETED,
        expect.objectContaining({
          sessionId: session.id,
        })
      );
    });

    it('broadcasts SESSION_DELETED to project subscribers', async () => {
      const projectId = session.projectId;

      await request(app)
        .delete(`/api/sessions/${session.id}`)
        .expect(204);

      expect(broadcastToProject).toHaveBeenCalledWith(
        projectId,
        WS_MESSAGE_TYPES.SESSION_DELETED,
        expect.objectContaining({
          projectId: projectId,
          sessionId: session.id,
        })
      );
    });

    it('broadcasts to both session and project on delete', async () => {
      await request(app)
        .delete(`/api/sessions/${session.id}`)
        .expect(204);

      expect(broadcastToSession).toHaveBeenCalledTimes(1);
      expect(broadcastToProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error cases', () => {
    it('does not broadcast when session not found for PATCH', async () => {
      await request(app)
        .patch('/api/sessions/non-existent-id')
        .send({ status: 'running' })
        .expect(404);

      expect(broadcastToSession).not.toHaveBeenCalled();
      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast when session not found for DELETE', async () => {
      await request(app)
        .delete('/api/sessions/non-existent-id')
        .expect(404);

      expect(broadcastToSession).not.toHaveBeenCalled();
      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast when project not found for session creation', async () => {
      await request(app)
        .post('/api/projects/non-existent-id/sessions')
        .send({ prompt: 'Test' })
        .expect(404);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast when PATCH has no valid fields', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ invalidField: 'value' })
        .expect(400);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast when PATCH has invalid status', async () => {
      await request(app)
        .patch(`/api/sessions/${session.id}`)
        .send({ status: 'invalid-status' })
        .expect(400);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  describe('Multiple subscribers scenario', () => {
    it('broadcasts creation correctly for multiple sessions', async () => {
      // Create first session
      const response1 = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .send({ prompt: 'First session' })
        .expect(201);

      // Create second session
      const response2 = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .send({ prompt: 'Second session' })
        .expect(201);

      // Both should have triggered broadcasts
      expect(broadcastToProject).toHaveBeenCalledTimes(2);

      // Verify different session IDs
      const calls = broadcastToProject.mock.calls;
      const sessionIds = calls.map((call) => call[2].session.id);
      expect(sessionIds).toContain(response1.body.id);
      expect(sessionIds).toContain(response2.body.id);
    });
  });
});
