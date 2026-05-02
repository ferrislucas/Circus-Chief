import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, modelProviders } from '../database.js';

// Mock websocket and sessionManager before importing the router.
// continueSession is asserted via spy to prove the cross-kind guard short-circuits.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

import messagesRouter from './sessions-messages.js';
import { continueSession } from '../services/sessionManager.js';

describe('Sessions Messages API — POST /:id/message cross-kind guard (Phase 7)', () => {
  let app;
  let project;
  let claudeSession;
  let codexSession;
  let anthropicProvider;
  let openaiProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', messagesRouter);

    project = projects.create('Test Project', '/tmp/phase7-messages');

    // Anthropic-kind third-party provider so we can register Claude-kind models
    // and exercise resolveAgentTypeFromModel against a real DB.
    anthropicProvider = modelProviders.create({
      name: 'Anthropic Provider',
      baseUrl: 'https://api.anthropic.example',
      authToken: 'key-a',
      kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: 'claude-sonnet-test',
      displayName: 'Claude Sonnet Test',
      tier: 'sonnet',
    });
    modelProviders.addModel(anthropicProvider.id, {
      modelId: 'claude-opus-test',
      displayName: 'Claude Opus Test',
      tier: 'opus',
    });

    // OpenAI-kind provider for Codex models.
    openaiProvider = modelProviders.create({
      name: 'OpenAI Provider',
      baseUrl: 'https://api.openai.example',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'gpt-4o-test',
      displayName: 'GPT 4o Test',
      tier: 'custom',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: 'o1-mini-test',
      displayName: 'O1 Mini Test',
      tier: 'custom',
    });

    // Two sessions, one per agent kind, both stopped so messages are accepted.
    claudeSession = sessions.create(project.id, 'Claude Session', 'hi', {
      agentType: 'claude-code',
      model: 'claude-sonnet-test',
    });
    sessions.update(claudeSession.id, { status: 'stopped' });

    codexSession = sessions.create(project.id, 'Codex Session', 'hi', {
      agentType: 'codex',
      model: 'gpt-4o-test',
    });
    sessions.update(codexSession.id, { status: 'stopped' });
  });

  afterEach(() => {
    try {
      sessions.delete(claudeSession.id);
    } catch {
      /* noop */
    }
    try {
      sessions.delete(codexSession.id);
    } catch {
      /* noop */
    }
    try {
      modelProviders.delete(anthropicProvider.id);
    } catch {
      /* noop */
    }
    try {
      modelProviders.delete(openaiProvider.id);
    } catch {
      /* noop */
    }
    try {
      projects.delete(project.id);
    } catch {
      /* noop */
    }
  });

  it('Claude session + Claude model → 200 and continuation dispatched (same-kind passthrough)', async () => {
    const res = await request(app)
      .post(`/api/sessions/${claudeSession.id}/message`)
      .send({ content: 'follow-up', model: 'claude-opus-test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(continueSession).toHaveBeenCalledTimes(1);
  });

  it('Claude session + Codex model → 400 CROSS_KIND_MODEL_SWITCH, continueSession NOT called', async () => {
    const res = await request(app)
      .post(`/api/sessions/${claudeSession.id}/message`)
      .send({ content: 'follow-up', model: 'gpt-4o-test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');
    expect(res.body.message).toMatch(/Claude Code/);
    expect(res.body.message).toMatch(/Codex/);
    // Route must short-circuit BEFORE dispatching continueSession.
    expect(continueSession).not.toHaveBeenCalled();

    // And the session's model must NOT have been flipped as a side effect.
    const refreshed = sessions.getById(claudeSession.id);
    expect(refreshed.model).toBe('claude-sonnet-test');
    expect(refreshed.agentType).toBe('claude-code');
  });

  it('Codex session + different Codex model → 200 (same-kind switch works)', async () => {
    const res = await request(app)
      .post(`/api/sessions/${codexSession.id}/message`)
      .send({ content: 'follow-up', model: 'o1-mini-test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(continueSession).toHaveBeenCalledTimes(1);
  });

  it('Codex session + Claude model → 400 CROSS_KIND_MODEL_SWITCH (reverse direction)', async () => {
    const res = await request(app)
      .post(`/api/sessions/${codexSession.id}/message`)
      .send({ content: 'follow-up', model: 'claude-sonnet-test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROSS_KIND_MODEL_SWITCH');
    expect(res.body.message).toMatch(/Codex/);
    expect(res.body.message).toMatch(/Claude Code/);
    expect(continueSession).not.toHaveBeenCalled();

    const refreshed = sessions.getById(codexSession.id);
    expect(refreshed.model).toBe('gpt-4o-test');
    expect(refreshed.agentType).toBe('codex');
  });

  it('Claude session with no explicit model falls back to session.model (same-kind) → 200', async () => {
    const res = await request(app)
      .post(`/api/sessions/${claudeSession.id}/message`)
      .send({ content: 'follow-up' });

    expect(res.status).toBe(200);
    expect(continueSession).toHaveBeenCalledTimes(1);
  });
});
