import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, commandButtons } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  continueSessionWithExistingMessage: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  regenerateSummary: vi.fn().mockResolvedValue(null),
  generateConversationSummary: vi.fn().mockResolvedValue('mock summary'),
  isConversationSummaryEnabled: vi.fn().mockReturnValue(true),
  cleanupSession: vi.fn(),
}));

// Mock commandRunner
vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    run: vi.fn().mockResolvedValue(undefined),
    getRunsBySession: vi.fn().mockReturnValue([]),
    isRunning: vi.fn().mockReturnValue(false),
    kill: vi.fn().mockReturnValue(false),
  },
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';
import { commandRunner } from '../services/commandRunner.js';

describe('Sessions API - Command Routes (sessions-commands.js)', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('POST /api/sessions/:id/command-buttons/:buttonId/run', () => {
    it('returns 404 when button does not exist', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/command-buttons/non-existent/run`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Command button not found');
    });

    it('starts a command run and returns runId', async () => {
      const button = commandButtons.create({ projectId: project.id, label: 'Test Button', command: 'echo hello' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/command-buttons/${button.id}/run`);

      expect(res.status).toBe(200);
      expect(res.body.runId).toBeDefined();
      expect(res.body.buttonId).toBe(button.id);
      expect(res.body.status).toBe('running');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/api/sessions/non-existent/command-buttons/btn-1/run');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/sessions/:id/command-buttons/runs', () => {
    it('returns active runs for the session', async () => {
      commandRunner.getRunsBySession.mockReturnValue([
        { runId: 'r1', buttonId: 'b1', status: 'running' },
      ]);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/command-buttons/runs`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].runId).toBe('r1');
    });

    it('returns empty array when no runs exist', async () => {
      commandRunner.getRunsBySession.mockReturnValue([]);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/command-buttons/runs`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .get('/api/sessions/non-existent/command-buttons/runs');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/sessions/:id/command-buttons/runs/:runId', () => {
    it('returns running command from memory', async () => {
      commandRunner.isRunning.mockReturnValue(true);
      commandRunner.getRunsBySession.mockReturnValue([
        { runId: 'r1', buttonId: 'b1', status: 'running', output: 'hello' },
      ]);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/command-buttons/runs/r1`);

      expect(res.status).toBe(200);
      expect(res.body.runId).toBe('r1');
      expect(res.body.status).toBe('running');
    });

    it('returns 404 when run not found in memory or database', async () => {
      commandRunner.isRunning.mockReturnValue(false);

      const res = await request(app)
        .get(`/api/sessions/${session.id}/command-buttons/runs/non-existent`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Run not found');
    });
  });

  describe('DELETE /api/sessions/:id/command-buttons/runs/:runId', () => {
    it('returns 204 when run is deleted successfully', async () => {
      const { commandRuns } = await import('../database.js');
      const button = commandButtons.create({ projectId: project.id, label: 'Del Button', command: 'echo del' });
      commandRuns.create({ id: 'run-del', sessionId: session.id, buttonId: button.id });
      commandRuns.complete('run-del', 0, 'output');

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/command-buttons/runs/run-del`);

      expect(res.status).toBe(204);
      expect(commandRuns.getById('run-del')).toBeNull();
    });

    it('returns 404 when run not found', async () => {
      const res = await request(app)
        .delete(`/api/sessions/${session.id}/command-buttons/runs/non-existent`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Run not found');
    });

    it('returns 409 when run is still running', async () => {
      const { commandRuns } = await import('../database.js');
      const button = commandButtons.create({ projectId: project.id, label: 'Running Button', command: 'sleep 10' });
      commandRuns.create({ id: 'run-active', sessionId: session.id, buttonId: button.id });

      commandRunner.isRunning.mockReturnValue(true);

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/command-buttons/runs/run-active`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Cannot delete a running command. Kill it first.');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .delete('/api/sessions/non-existent/command-buttons/runs/run-1');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/command-buttons/runs/:runId/kill', () => {
    it('kills a running command', async () => {
      commandRunner.kill.mockReturnValue(true);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/command-buttons/runs/r1/kill`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.runId).toBe('r1');
    });

    it('returns 404 when run not found or already completed', async () => {
      commandRunner.kill.mockReturnValue(false);

      const res = await request(app)
        .post(`/api/sessions/${session.id}/command-buttons/runs/non-existent/kill`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Run not found or already completed');
    });
  });
});
