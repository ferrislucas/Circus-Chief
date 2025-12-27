import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, commandButtons } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock gitSessionSetup
vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({ workingDirectory: '/tmp/test', gitWorktree: null }),
}));

// Mock commandRunner
vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    run: vi.fn().mockResolvedValue(0),
    kill: vi.fn().mockReturnValue(true),
    getRunsBySession: vi.fn().mockReturnValue([]),
  },
}));

// Import after mocks
import sessionsRouter from './sessions.js';
import { commandRunner } from '../services/commandRunner.js';

describe('CommandButtons API', () => {
  let app;
  let projectId;
  let sessionId;
  let buttonId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test project
    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    // Create test session
    const session = sessions.create(projectId, 'Test Session', 'Test prompt');
    sessionId = session.id;

    // Create test button
    const button = commandButtons.create({
      projectId,
      label: 'Test Button',
      command: 'echo test',
    });
    buttonId = button.id;
  });

  afterEach(() => {
    // Cleanup
    if (buttonId) {
      try {
        commandButtons.delete(buttonId);
      } catch (e) {
        // ignore
      }
    }
    if (sessionId) {
      try {
        sessions.delete(sessionId);
      } catch (e) {
        // ignore
      }
    }
    if (projectId) {
      try {
        projects.delete(projectId);
      } catch (e) {
        // ignore
      }
    }
  });

  describe('GET /api/sessions/:id/command-buttons/runs', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/nonexistent/command-buttons/runs');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('returns empty array when no active runs', async () => {
      commandRunner.getRunsBySession.mockReturnValue([]);

      const res = await request(app).get(`/api/sessions/${sessionId}/command-buttons/runs`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(commandRunner.getRunsBySession).toHaveBeenCalledWith(sessionId);
    });

    it('returns active runs for session', async () => {
      const mockRuns = [
        {
          runId: 'run-1',
          buttonId: buttonId,
          status: 'running',
          output: 'Hello World\n',
          startTime: Date.now(),
        },
        {
          runId: 'run-2',
          buttonId: buttonId,
          status: 'running',
          output: 'Another output\n',
          startTime: Date.now(),
        },
      ];
      commandRunner.getRunsBySession.mockReturnValue(mockRuns);

      const res = await request(app).get(`/api/sessions/${sessionId}/command-buttons/runs`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockRuns);
      expect(res.body.length).toBe(2);
      expect(res.body[0].runId).toBe('run-1');
      expect(res.body[0].output).toBe('Hello World\n');
    });
  });

  describe('POST /api/sessions/:id/command-buttons/:buttonId/run', () => {
    it('passes metadata to commandRunner.run', async () => {
      const res = await request(app).post(
        `/api/sessions/${sessionId}/command-buttons/${buttonId}/run`
      );

      expect(res.status).toBe(200);
      expect(res.body.buttonId).toBe(buttonId);
      expect(res.body.status).toBe('running');

      // Wait a bit for the async run to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify commandRunner.run was called with metadata
      expect(commandRunner.run).toHaveBeenCalled();
      const runCall = commandRunner.run.mock.calls[0];
      expect(runCall[6]).toEqual({ sessionId, buttonId });
    });
  });
});
