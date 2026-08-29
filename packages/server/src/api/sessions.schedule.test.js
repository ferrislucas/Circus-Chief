import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from './sessions.js';
import { projects, sessions, modelProviders, messages, conversations } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as diffService from '../services/diffService.js';
import * as gitService from '../services/gitService.js';
import {
  activeSessions,
  handleTurnCompletion,
} from '../services/streamEventHandler.js';
import { captureScheduleWakeup, __resetWakeupTurnStatesForTest } from '../services/scheduleWakeupBridge.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summary service (needed by sessions-patch.js)
vi.mock('../services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
  propagatePrUrlToParent: vi.fn(),
}));

vi.mock('../services/diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue({ staged: null, unstaged: null, untracked: null }),
  getChangesBranch: vi.fn(),
}));

vi.mock('../services/gitService.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
}));

// Mock prStatusService (needed by sessions-patch.js)
vi.mock('../services/prStatusService.js', () => ({
  checkSessionCiStatusNow: vi.fn().mockResolvedValue(false),
}));

// Mock summaryBroadcast (needed by sessions-patch.js)
vi.mock('../services/summaryBroadcast.js', async (importOriginal) => ({
  ...await importOriginal(),
  broadcastSummaryUpdate: vi.fn(),
}));

describe('Sessions API - POST /:id/schedule', () => {
  let app;
  let project;
  let session;
  let openaiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    activeSessions.clear();
    gitService.isGitRepo.mockResolvedValue(true);
    diffService.getChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
    openaiProvider = null;
  });

  afterEach(() => {
    activeSessions.clear();
    if (openaiProvider) {
      try {
        modelProviders.delete(openaiProvider.id);
      } catch {
        // Test cleanup only.
      }
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('schedules an idle session with prompt and future scheduledAt', async () => {
    const scheduledAt = Date.now() + 3600000; // 1 hour from now
    const prompt = 'Continue the analysis from where we left off';

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    expect(response.body.status).toBe('scheduled');
    expect(response.body.scheduledAt).toBe(scheduledAt);
    expect(response.body.pendingPrompt).toBe(prompt);
    expect(response.body.pendingModel).toBeNull();

    const stored = sessions.getById(session.id);
    expect(stored.status).toBe('scheduled');
    expect(stored.scheduledAt).toBe(scheduledAt);
    expect(stored.pendingPrompt).toBe(prompt);
  });

  it('accepts an ISO 8601 scheduledAt string and normalizes to epoch ms', async () => {
    const futureMs = Date.now() + 3600000;
    const isoString = new Date(futureMs).toISOString();
    const prompt = 'Resume work';

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt, scheduledAt: isoString })
      .expect(200);

    expect(typeof response.body.scheduledAt).toBe('number');
    expect(response.body.scheduledAt).toBe(futureMs);
  });

  it('sets pendingModel when a valid model is provided', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'opus',
      })
      .expect(200);

    expect(response.body.pendingModel).toBe('opus');
    expect(sessions.getById(session.id).pendingModel).toBe('opus');
  });

  it('keeps an active running session invisible to the polling scheduler until turn completion', async () => {
    sessions.update(session.id, { status: 'running' });
    activeSessions.set(session.id, { controller: { signal: { aborted: false } } });

    const scheduledAt = Date.now() + 100;
    const prompt = 'Continue after the current turn finishes';

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt, scheduledAt })
      .expect(200);

    expect(response.body.status).toBe('running');
    expect(response.body.scheduledAt).toBe(scheduledAt);
    expect(response.body.pendingPrompt).toBe(prompt);

    const storedBeforeCompletion = sessions.getById(session.id);
    expect(storedBeforeCompletion.status).toBe('running');
    expect(storedBeforeCompletion.scheduledAt).toBe(scheduledAt);
    expect(storedBeforeCompletion.pendingPrompt).toBe(prompt);
    expect(sessions.getScheduledSessionsDue(Date.now() + 1000).map((s) => s.id)).not.toContain(session.id);

    await handleTurnCompletion(session.id, '/tmp/test', {
      checkProactiveReschedule: vi.fn().mockResolvedValue(false),
      handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
      handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
    });

    const storedAfterCompletion = sessions.getById(session.id);
    expect(storedAfterCompletion.status).toBe('scheduled');
    expect(storedAfterCompletion.scheduledAt).toBe(scheduledAt);
    expect(storedAfterCompletion.pendingPrompt).toBe(prompt);
  });

  it('clears stale pendingConversationId when scheduling an explicit prompt', async () => {
    const staleConversation = conversations.create(session.id, 'Stale retry conversation');
    sessions.update(session.id, {
      status: 'waiting',
      pendingPrompt: 'Old retry prompt',
      pendingConversationId: staleConversation.id,
    });

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'New explicit continuation prompt',
        scheduledAt: Date.now() + 3600000,
      })
      .expect(200);

    expect(response.body.pendingPrompt).toBe('New explicit continuation prompt');
    expect(response.body.pendingConversationId).toBeNull();

    const stored = sessions.getById(session.id);
    expect(stored.pendingPrompt).toBe('New explicit continuation prompt');
    expect(stored.pendingConversationId).toBeNull();
  });

  it('returns 400 for a cross-kind model switch on a started session', async () => {
    openaiProvider = modelProviders.create({
      name: 'OpenAI Schedule Test',
      baseUrl: 'https://api.openai.schedule',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'gpt-schedule-cross-kind',
      displayName: 'GPT Schedule Cross Kind',
      tier: 'custom',
    });

    messages.create(session.id, 'assistant', 'Started response');

    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'gpt-schedule-cross-kind',
      })
      .expect(400);

    expect(response.body.error).toBe('CROSS_KIND_MODEL_SWITCH');
    expect(sessions.getById(session.id).pendingModel).toBeNull();
  });

  it('broadcasts SESSION_STATUS and SESSION_UPDATED on success', async () => {
    const scheduledAt = Date.now() + 3600000;

    await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt })
      .expect(200);

    // SESSION_STATUS broadcast
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.SESSION_STATUS,
      expect.objectContaining({ sessionId: session.id, status: 'scheduled' }),
    );

    // SESSION_UPDATED broadcast to session subscribers
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id }),
    );

    // SESSION_UPDATED broadcast to project subscribers
    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id }),
    );
  });

  it('keeps a running session scheduled after completion and broadcasts completion side effects', async () => {
    sessions.update(session.id, { status: 'running' });
    activeSessions.set(session.id, { controller: { signal: { aborted: false } } });

    const scheduledAt = Date.now() + 3600000;
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue after the current turn', scheduledAt })
      .expect(200);

    expect(response.body.status).toBe('running');
    vi.clearAllMocks();
    diffService.getChanges.mockResolvedValue({
      staged: 'diff --git a/server.js b/server.js\n+change',
      unstaged: null,
      untracked: null,
    });

    const mockAutoSend = vi.fn().mockResolvedValue(false);
    const mockTemplateTrigger = vi.fn().mockResolvedValue(undefined);

    const result = await handleTurnCompletion(session.id, '/tmp/test', {
      checkProactiveReschedule: vi.fn().mockResolvedValue(false),
      handleAutoSendIfNeeded: mockAutoSend,
      handleTemplateTriggerIfNeeded: mockTemplateTrigger,
    });

    // A mid-turn explicit schedule is a continuation obligation, so completion
    // reports it as a reschedule (sessionExecution must not finalize the turn
    // as successful lane work — see commit 6a52e631).
    expect(result).toEqual({ wasRescheduled: true, heldForLimit: false });
    expect(sessions.getById(session.id)).toEqual(expect.objectContaining({
      status: 'scheduled',
      scheduledAt,
      pendingPrompt: 'Continue after the current turn',
    }));
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.SESSION_STATUS,
      expect.objectContaining({ status: 'scheduled' }),
    );
    expect(broadcastToSession).toHaveBeenCalledWith(
      session.id,
      WS_MESSAGE_TYPES.CHANGES_UPDATE,
      expect.objectContaining({ sessionId: session.id, hasChanges: true, changeCount: 1 }),
    );
    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({
        sessionId: session.id,
        session: expect.objectContaining({ status: 'scheduled' }),
      }),
    );
    expect(mockAutoSend).not.toHaveBeenCalled();
    expect(mockTemplateTrigger).not.toHaveBeenCalled();
  });

  // ── ScheduleWakeup precedence, end-to-end against the real DB ────────────────
  //
  // These exercise POST /:id/schedule and the ScheduleWakeup bridge together,
  // against the real (unmocked) sessions repository — unlike
  // scheduleWakeupBridge.test.js and streamEventHandler.test.js, which mock
  // `sessions.update` and so never round-trip through the actual
  // camelCase<->snake_case column mapping. Precedence between the two
  // mechanisms is last-call-wins within the turn (see scheduleWakeupBridge.js).

  describe('precedence against ScheduleWakeup', () => {
    afterEach(() => {
      __resetWakeupTurnStatesForTest();
    });

    it('an explicit schedule made after a ScheduleWakeup call in the same turn wins', async () => {
      sessions.update(session.id, { status: 'running' });
      const controller = { signal: { aborted: false } };
      activeSessions.set(session.id, { controller });

      captureScheduleWakeup(session.id, controller, [
        { type: 'tool_use', id: 'wk-1', name: 'ScheduleWakeup', input: { delaySeconds: 300, prompt: 'earlier wakeup prompt' } },
      ]);

      await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ prompt: 'later explicit prompt', scheduledAt: Date.now() + 3600000 })
        .expect(200);

      await handleTurnCompletion(session.id, '/tmp/test', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      const stored = sessions.getById(session.id);
      expect(stored.status).toBe('scheduled');
      expect(stored.pendingPrompt).toBe('later explicit prompt');
    });

    it('a ScheduleWakeup call made after an explicit schedule in the same turn wins', async () => {
      sessions.update(session.id, { status: 'running' });
      const controller = { signal: { aborted: false } };
      activeSessions.set(session.id, { controller });

      await request(app)
        .post(`/api/sessions/${session.id}/schedule`)
        .send({ prompt: 'earlier explicit prompt', scheduledAt: Date.now() + 3600000 })
        .expect(200);

      captureScheduleWakeup(session.id, controller, [
        { type: 'tool_use', id: 'wk-2', name: 'ScheduleWakeup', input: { delaySeconds: 300, prompt: 'later wakeup prompt' } },
      ]);

      await handleTurnCompletion(session.id, '/tmp/test', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      const stored = sessions.getById(session.id);
      expect(stored.status).toBe('scheduled');
      expect(stored.pendingPrompt).toBe('later wakeup prompt');
      // scheduledAt is measured from turn-completion time, not from capture time.
      expect(stored.scheduledAt).toBeGreaterThan(Date.now() + 250 * 1000);
      expect(stored.scheduledAt).toBeLessThanOrEqual(Date.now() + 300 * 1000);
    });

    it('a ScheduleWakeup call with no competing explicit schedule persists through the real repository', async () => {
      sessions.update(session.id, { status: 'running' });
      const controller = { signal: { aborted: false } };
      activeSessions.set(session.id, { controller });

      captureScheduleWakeup(session.id, controller, [
        { type: 'tool_use', id: 'wk-3', name: 'ScheduleWakeup', input: { delaySeconds: 90, reason: 'polling CI', prompt: 'Continue: check CI' } },
      ]);

      await handleTurnCompletion(session.id, '/tmp/test', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      const stored = sessions.getById(session.id);
      expect(stored.status).toBe('scheduled');
      expect(stored.pendingPrompt).toBe('Continue: check CI');
      expect(stored.pendingConversationId).toBeNull();
      expect(Number.isFinite(stored.scheduledAt)).toBe(true);
      expect(stored.scheduledAt).toBeGreaterThan(Date.now());
      expect(sessions.getScheduledSessionsDue(stored.scheduledAt + 1000).map((s) => s.id)).toContain(session.id);
    });

    it('severs a stale pendingModel through the real repository when a wakeup supersedes it', async () => {
      // Real-DB proof that pendingModel:null survives the camelCase<->snake_case
      // column mapping: a stale one-shot model from a prior explicit schedule
      // must not leak into the wakeup's row write.
      sessions.update(session.id, { status: 'running', pendingModel: 'deepseek-v4-pro-0813' });
      const controller = { signal: { aborted: false } };
      activeSessions.set(session.id, { controller });

      captureScheduleWakeup(session.id, controller, [
        { type: 'tool_use', id: 'wk-model', name: 'ScheduleWakeup', input: { delaySeconds: 90, prompt: 'Continue: check CI' } },
      ]);

      await handleTurnCompletion(session.id, '/tmp/test', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      const stored = sessions.getById(session.id);
      expect(stored.status).toBe('scheduled');
      expect(stored.pendingPrompt).toBe('Continue: check CI');
      expect(stored.pendingModel).toBeNull();
    });

    it('preserves the autonomous-loop sentinel resume end-to-end without a stale pendingModel', async () => {
      // Round-trip proof that the sentinel path keeps pendingConversationId (so
      // the scheduler resumes the loop's exact user message) *and* clears
      // pendingModel (so launch does not force modelChanged=true and drop the
      // Claude conversation context).
      sessions.update(session.id, { status: 'running', pendingModel: 'X' });
      const controller = { signal: { aborted: false } };
      activeSessions.set(session.id, { controller });

      const loopConversation = conversations.create(session.id, 'Loop conversation', true);
      conversations.update(loopConversation.id, { claudeSessionId: 'claude-loop' });
      messages.create(session.id, 'user', '/loop', { conversationId: loopConversation.id });

      captureScheduleWakeup(session.id, controller, [
        { type: 'tool_use', id: 'wk-loop', name: 'ScheduleWakeup', input: { delaySeconds: 600, prompt: '<<autonomous-loop-dynamic>>' } },
      ]);

      await handleTurnCompletion(session.id, '/tmp/test', {
        checkProactiveReschedule: vi.fn().mockResolvedValue(false),
        handleAutoSendIfNeeded: vi.fn().mockResolvedValue(false),
        handleTemplateTriggerIfNeeded: vi.fn().mockResolvedValue(undefined),
      });

      const stored = sessions.getById(session.id);
      expect(stored.status).toBe('scheduled');
      expect(stored.pendingConversationId).toBe(loopConversation.id);
      expect(stored.pendingModel).toBeNull();
    });
  });

  // ── Validation failures ─────────────────────────────────────────────────────

  it('returns 404 for unknown session id', async () => {
    await request(app)
      .post('/api/sessions/nonexistent-id/schedule')
      .send({ prompt: 'Hello', scheduledAt: Date.now() + 3600000 })
      .expect(404);
  });

  it('returns 400 when prompt is missing', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when prompt is empty string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: '   ', scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when prompt is not a string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 42, scheduledAt: Date.now() + 3600000 })
      .expect(400);

    expect(response.body.error).toMatch(/prompt/i);
  });

  it('returns 400 when scheduledAt is missing', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue' })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when scheduledAt is in the past', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: Date.now() - 1000 })
      .expect(400);

    expect(response.body.error).toMatch(/future/i);
  });

  it('returns 400 when scheduledAt is invalid (non-finite number)', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: Infinity })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when scheduledAt is an unparseable string', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({ prompt: 'Continue', scheduledAt: 'not-a-date' })
      .expect(400);

    expect(response.body.error).toMatch(/scheduledAt/i);
  });

  it('returns 400 when model is an invalid model id', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        model: 'definitely-not-a-real-model-id-xyz',
      })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });

  it('returns 400 when a reschedule-policy field is included', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        autoRescheduleEnabled: true,
      })
      .expect(400);

    expect(response.body.error).toMatch(/Unexpected field/i);
    expect(response.body.error).toContain('autoRescheduleEnabled');
  });

  it('returns 400 when rescheduleDelayMinutes is included', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        rescheduleDelayMinutes: 30,
      })
      .expect(400);

    expect(response.body.error).toMatch(/Unexpected field/i);
    expect(response.body.error).toContain('rescheduleDelayMinutes');
  });

  it('returns 400 for arbitrary unknown keys', async () => {
    const response = await request(app)
      .post(`/api/sessions/${session.id}/schedule`)
      .send({
        prompt: 'Continue',
        scheduledAt: Date.now() + 3600000,
        junkKey: 'garbage',
      })
      .expect(400);

    expect(response.body.error).toMatch(/Unexpected field/i);
    expect(response.body.error).toContain('junkKey');
  });
});
