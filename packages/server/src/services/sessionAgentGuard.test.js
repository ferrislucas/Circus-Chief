import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkCrossKindSwitch, agentLabel, AGENT_TYPE_LABELS } from './sessionAgentGuard.js';
import { projects, sessions, modelProviders } from '../database.js';

describe('sessionAgentGuard', () => {
  describe('agentLabel', () => {
    it('returns "Claude Code" for claude-code', () => {
      expect(agentLabel('claude-code')).toBe('Claude Code');
    });

    it('returns "Codex" for codex', () => {
      expect(agentLabel('codex')).toBe('Codex');
    });

    it('returns the raw value for unknown agent types', () => {
      expect(agentLabel('unknown-type')).toBe('unknown-type');
    });

    it('returns "unknown" for null/undefined', () => {
      expect(agentLabel(null)).toBe('unknown');
      expect(agentLabel(undefined)).toBe('unknown');
    });
  });

  describe('AGENT_TYPE_LABELS', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(AGENT_TYPE_LABELS)).toBe(true);
    });
  });

  describe('checkCrossKindSwitch', () => {
    let project;
    let anthropicProvider;
    let openaiProvider;

    beforeEach(() => {
      project = projects.create('Guard Test Project', '/tmp/guard-test');

      // Anthropic-kind provider
      anthropicProvider = modelProviders.create({
        name: 'Anthropic Guard Test',
        baseUrl: 'https://api.anthropic.guard',
        authToken: 'key-a',
        kind: 'anthropic',
      });
      modelProviders.addModel(anthropicProvider.id, {
        modelId: 'claude-sonnet-guard',
        displayName: 'Claude Sonnet Guard',
        tier: 'sonnet',
      });
      modelProviders.addModel(anthropicProvider.id, {
        modelId: 'claude-opus-guard',
        displayName: 'Claude Opus Guard',
        tier: 'opus',
      });

      // OpenAI-kind provider
      openaiProvider = modelProviders.create({
        name: 'OpenAI Guard Test',
        baseUrl: 'https://api.openai.guard',
        authToken: 'key-o',
        kind: 'openai',
      });
      modelProviders.addModel(openaiProvider.id, {
        modelId: 'gpt-4o-guard',
        displayName: 'GPT 4o Guard',
        tier: 'custom',
      });
    });

    afterEach(() => {
      try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
      try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
      try { projects.delete(project.id); } catch { /* noop */ }
    });

    it('returns null for same-kind (Claude session + Claude model)', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      expect(checkCrossKindSwitch(session, 'claude-opus-guard')).toBeNull();
    });

    it('returns null for same-kind (Codex session + Codex model)', () => {
      const session = { agentType: 'codex', model: 'gpt-4o-guard' };
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('returns null when no model is requested and session model matches kind', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('returns error for Claude session + Codex model', () => {
      const session = { agentType: 'claude-code', model: 'claude-sonnet-guard' };
      const result = checkCrossKindSwitch(session, 'gpt-4o-guard');
      expect(result).toEqual({
        error: 'CROSS_KIND_MODEL_SWITCH',
        message: expect.stringContaining('Claude Code'),
      });
      expect(result.message).toContain('Codex');
    });

    it('returns error for Codex session + Claude model', () => {
      const session = { agentType: 'codex', model: 'gpt-4o-guard' };
      const result = checkCrossKindSwitch(session, 'claude-sonnet-guard');
      expect(result).toEqual({
        error: 'CROSS_KIND_MODEL_SWITCH',
        message: expect.stringContaining('Codex'),
      });
      expect(result.message).toContain('Claude Code');
    });

    it('defaults agentType to claude-code when not set', () => {
      const session = { model: null };
      // null model resolves to claude-code, and session defaults to claude-code => same kind
      expect(checkCrossKindSwitch(session, null)).toBeNull();
    });

    it('detects cross-kind switch when session has no agentType and model is OpenAI', () => {
      const session = { model: null };
      const result = checkCrossKindSwitch(session, 'gpt-4o-guard');
      expect(result).not.toBeNull();
      expect(result.error).toBe('CROSS_KIND_MODEL_SWITCH');
    });
  });
});
