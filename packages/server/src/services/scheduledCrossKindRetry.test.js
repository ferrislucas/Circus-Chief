import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { projects, sessions, conversations, messages, modelProviders } from '../database.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { schedulerService } from './schedulerService.js';
import * as sessionManager from './sessionManager.js';
import { activeSessions } from './sessionExecutionOwnership.js';

vi.mock('../websocket.js', () => ({ broadcast: vi.fn(), broadcastToSession: vi.fn(), broadcastToProject: vi.fn() }));
vi.mock('./summaryService.js', () => ({ onSessionActivity: vi.fn(), onSessionComplete: vi.fn(), extractPrUrlIfNeeded: vi.fn(), generateSummaryIfNeeded: vi.fn() }));
vi.mock('./hookService.js', () => ({ executeHookAsync: vi.fn() }));
vi.mock('./gitService.js', () => ({ ensureWorktreeCommitAttributionHook: vi.fn() }));

describe('scheduled cross-kind existing-message retry', () => {
  it('replays history until a destination native chain is established', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scheduled-cross-kind-'));
    const project = projects.create('Scheduled retry', dir);
    const claude = modelProviders.create({ name: 'Retry Claude', kind: 'anthropic' });
    const grok = modelProviders.create({ name: 'Retry Grok', kind: 'xai' });
    modelProviders.addModel(claude.id, { modelId: 'claude-scheduled-retry', displayName: 'Claude' });
    modelProviders.addModel(grok.id, { modelId: 'grok-scheduled-retry', displayName: 'Grok' });
    const captured = [];
    let failures = 2;
    const agent = {
      supportsResume: () => true,
      needsConversationContext: () => false,
      async *execute(params) {
        captured.push(params);
        if (failures-- > 0) throw new Error('Service unavailable: overloaded');
        yield { type: 'system', subtype: 'init', session_id: 'new-grok-id', model: 'grok-scheduled-retry', slash_commands: [] };
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'completed' }] } };
        yield { type: 'result', subtype: 'success' };
      },
    };
    const spy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(agent);
    const previousManager = schedulerService.sessionManager;
    schedulerService.initialize(sessionManager);
    try {
      const session = sessions.create(project.id, 'Retry', 'initial', { model: 'claude-scheduled-retry', providerId: claude.id, status: 'waiting' });
      const conv = conversations.ensureActiveConversation(session.id);
      messages.create(session.id, 'user', 'earlier question', { conversationId: conv.id });
      messages.create(session.id, 'assistant', 'earlier answer', { conversationId: conv.id });
      conversations.update(conv.id, { claudeSessionId: 'old-claude-id' });
      sessions.update(session.id, { lastExecutedModel: 'claude-scheduled-retry', lastExecutedProviderId: claude.id, autoRescheduleEnabled: true, rescheduleOnServiceError: true, rescheduleDelayMinutes: 1 });
      await sessionManager.continueSession(session.id, 'latest prompt', dir, { interactive: true, model: 'grok-scheduled-retry', providerId: grok.id });
      for (let i = 0; i < 2; i++) {
        const scheduled = sessions.getById(session.id);
        expect(scheduled.status).toBe('scheduled');
        expect(scheduled.pendingConversationId).toBe(conv.id);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(scheduled.scheduledAt + 1);
        try {
          await schedulerService.startScheduledSession(scheduled);
        } finally {
          clock.mockRestore();
        }
      }
      expect(captured).toHaveLength(3);
      for (const params of captured) {
        expect(params.options.resume ?? null).toBeNull();
        expect(params.prompt).toContain('earlier answer');
        expect(params.prompt.match(/latest prompt/g)).toHaveLength(1);
      }
      expect(messages.getByConversationId(conv.id).filter(m => m.content === 'latest prompt')).toHaveLength(1);
      expect(conversations.getById(conv.id).claudeSessionId).toBe('new-grok-id');
      await sessionManager.continueSession(session.id, 'next prompt', dir, { interactive: true });
      expect(captured.at(-1).options.resume).toBe('new-grok-id');
      expect(captured.at(-1).prompt).toBe('next prompt');
    } finally {
      spy.mockRestore();
      schedulerService.initialize(previousManager);
      activeSessions.clear();
      modelProviders.delete(claude.id);
      modelProviders.delete(grok.id);
      projects.delete(project.id);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
