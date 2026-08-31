import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import lifecycleRouter from './sessions-lifecycle.js';
import { projects, sessions } from '../database.js';
import { schedulerService } from '../services/schedulerService.js';

// Mount only the lifecycle router (where run-scheduled-now lives) rather
// than the full sessions.js router — this endpoint doesn't touch the other
// sub-routers (PR status, summaries, gh, etc.), so there's nothing else to
// mock beyond websocket broadcasting.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

describe('POST /api/sessions/:id/run-scheduled-now', () => {
  let app;
  let project;
  let mockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', lifecycleRouter);

    project = projects.create('Test Project', '/tmp/test');

    // Real schedulerService singleton (the same instance the route imports),
    // wired to a mock sessionManager so no real agent process ever spawns.
    // This lets these tests exercise the *actual* atomic claim against a
    // real in-memory SQLite DB, not a mocked repository.
    mockSessionManager = {
      runSession: vi.fn().mockResolvedValue(undefined),
      continueSession: vi.fn().mockResolvedValue(undefined),
      continueSessionWithExistingMessage: vi.fn().mockResolvedValue(undefined),
    };
    schedulerService.initialize(mockSessionManager);
  });

  afterEach(() => {
    schedulerService.stop();
  });

  function createScheduledSession({ pendingPrompt = 'Original prompt', scheduledAt = Date.now() - 1000 } = {}) {
    const session = sessions.create(project.id, 'Scheduled Session', pendingPrompt, 'standard', false, null, null, 'scheduled');
    return sessions.update(session.id, { scheduledAt, pendingPrompt });
  }

  describe('validation', () => {
    it('404s for an unknown session', async () => {
      await request(app).post('/api/sessions/does-not-exist/run-scheduled-now').expect(404);
    });

    it('409s when the session is not scheduled', async () => {
      const session = sessions.create(project.id, 'Waiting Session', 'Prompt');
      sessions.update(session.id, { status: 'waiting' });

      const res = await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(409);
      expect(res.body.error).toMatch(/no pending scheduled turn/i);
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    it('409s when scheduled but missing a pendingPrompt', async () => {
      const session = sessions.create(project.id, 'No Prompt', 'Prompt', 'standard', false, null, null, 'scheduled');
      sessions.update(session.id, { scheduledAt: Date.now() - 1000, pendingPrompt: null });

      await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(409);
    });

    it('409s when scheduled but missing scheduledAt', async () => {
      const session = sessions.create(project.id, 'No Fire Time', 'Prompt', 'standard', false, null, null, 'scheduled');
      sessions.update(session.id, { scheduledAt: null, pendingPrompt: 'Prompt' });

      const res = await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(409);

      expect(res.body.error).toMatch(/no pending scheduled turn/i);
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    it('rejects a blank prompt override with 400 and never claims the session', async () => {
      const session = createScheduledSession();

      const res = await request(app)
        .post(`/api/sessions/${session.id}/run-scheduled-now`)
        .send({ prompt: '   ' })
        .expect(400);

      expect(res.body.error).toMatch(/non-empty string/);
      expect(sessions.getById(session.id).status).toBe('scheduled');
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });

    it('rejects a non-string prompt override with 400', async () => {
      const session = createScheduledSession();

      await request(app)
        .post(`/api/sessions/${session.id}/run-scheduled-now`)
        .send({ prompt: 42 })
        .expect(400);

      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });
  });

  describe('starting a scheduled draft (fresh session)', () => {
    it('starts immediately and clears scheduledAt/pendingPrompt', async () => {
      const session = createScheduledSession({ pendingPrompt: 'Hello' });

      const res = await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(200);

      expect(res.body.scheduledAt).toBeNull();
      expect(res.body.pendingPrompt).toBeNull();
      expect(mockSessionManager.runSession).toHaveBeenCalledTimes(1);
      const [sessionId, prompt] = mockSessionManager.runSession.mock.calls[0];
      expect(sessionId).toBe(session.id);
      expect(prompt).toBe('Hello');
    });

    it('applies an edited prompt override atomically with the claim, not the stale persisted prompt', async () => {
      const session = createScheduledSession({ pendingPrompt: 'saved prompt' });

      const res = await request(app)
        .post(`/api/sessions/${session.id}/run-scheduled-now`)
        .send({ prompt: 'edited prompt' })
        .expect(200);

      expect(res.body.pendingPrompt).toBeNull();
      expect(mockSessionManager.runSession.mock.calls[0][1]).toBe('edited prompt');
    });

    it('starts with the persisted prompt when no override is sent', async () => {
      const session = createScheduledSession({ pendingPrompt: 'saved prompt' });

      await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(200);

      expect(mockSessionManager.runSession.mock.calls[0][1]).toBe('saved prompt');
    });
  });

  describe('pre-launch failure recovery', () => {
    it('surfaces a 500 and preserves scheduledAt/pendingPrompt for retry when project lookup fails', async () => {
      const session = createScheduledSession({ pendingPrompt: 'Hello' });
      const originalScheduledAt = sessions.getById(session.id).scheduledAt;

      vi.spyOn(projects, 'getById').mockReturnValueOnce(null);

      const res = await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(500);
      expect(res.body.error).toMatch(/Project not found/);

      const persisted = sessions.getById(session.id);
      expect(persisted.status).toBe('error');
      // The claim never cleared these fields, and this failure happened
      // before the durable-clear step, so they're still intact.
      expect(persisted.pendingPrompt).toBe('Hello');
      expect(persisted.scheduledAt).toBe(originalScheduledAt);
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });
  });

  describe('concurrency', () => {
    it('two concurrent manual requests for the same session produce exactly one launch, both responses succeed', async () => {
      const session = createScheduledSession({ pendingPrompt: 'Hello' });
      // Give the "turn" enough width that both requests' claim attempts are
      // in flight before either finishes, so a real race is exercised.
      mockSessionManager.runSession.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30)));

      const [res1, res2] = await Promise.all([
        request(app).post(`/api/sessions/${session.id}/run-scheduled-now`),
        request(app).post(`/api/sessions/${session.id}/run-scheduled-now`),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(mockSessionManager.runSession).toHaveBeenCalledTimes(1);
      // Both responses are idempotent — they reflect the one session that
      // did start, not a duplicated or half-updated state.
      expect(res1.body.pendingPrompt).toBeNull();
      expect(res2.body.pendingPrompt).toBeNull();
    });

    it('a manual request racing the poller results in exactly one launch', async () => {
      const session = createScheduledSession({ pendingPrompt: 'Hello' });
      mockSessionManager.runSession.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30)));

      const [manualRes] = await Promise.all([
        request(app).post(`/api/sessions/${session.id}/run-scheduled-now`),
        schedulerService.checkScheduledSessions(),
      ]);

      expect(manualRes.status).toBe(200);
      expect(mockSessionManager.runSession).toHaveBeenCalledTimes(1);
      expect(sessions.getById(session.id).pendingPrompt).toBeNull();
    });

    it('a manual request with a prompt override racing the poller: the launch uses whichever caller actually won the claim', async () => {
      const session = createScheduledSession({ pendingPrompt: 'saved prompt' });
      mockSessionManager.runSession.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30)));

      await Promise.all([
        request(app)
          .post(`/api/sessions/${session.id}/run-scheduled-now`)
          .send({ prompt: 'edited prompt' }),
        schedulerService.checkScheduledSessions(),
      ]);

      expect(mockSessionManager.runSession).toHaveBeenCalledTimes(1);
      // Whichever caller won, the prompt used is a whole value it owned —
      // never a mix of "edited" and "saved" from the two racing callers.
      const usedPrompt = mockSessionManager.runSession.mock.calls[0][1];
      expect(['edited prompt', 'saved prompt']).toContain(usedPrompt);
    });
  });

  describe('scheduled continuation (existing session with history)', () => {
    it('starts the continuation immediately and clears scheduling fields', async () => {
      const session = sessions.create(project.id, 'Continuation Session', 'First message');
      sessions.update(session.id, { status: 'scheduled', scheduledAt: Date.now() - 1000, pendingPrompt: 'Follow up' });
      // Simulate prior conversation history so the service treats this as a continuation.
      const { messages } = await import('../database.js');
      const { conversations } = await import('../database.js');
      const conv = conversations.getActiveBySessionId(session.id);
      messages.create(session.id, 'user', 'First message', { conversationId: conv.id });
      messages.create(session.id, 'assistant', 'Response', { conversationId: conv.id });

      const res = await request(app).post(`/api/sessions/${session.id}/run-scheduled-now`).expect(200);

      expect(res.body.scheduledAt).toBeNull();
      expect(res.body.pendingPrompt).toBeNull();
      expect(mockSessionManager.continueSession).toHaveBeenCalledTimes(1);
      expect(mockSessionManager.continueSession.mock.calls[0][1]).toBe('Follow up');
      expect(mockSessionManager.runSession).not.toHaveBeenCalled();
    });
  });
});
