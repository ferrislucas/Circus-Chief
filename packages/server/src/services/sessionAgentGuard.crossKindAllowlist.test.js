import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { projects, modelProviders } from '../database.js';
import {
  IN_SCOPE_SWITCH_KINDS,
  isCrossKindSwitchAllowed,
} from './sessionAgentGuard.js';

/**
 * RED (plan Phase 1): pins the FRD §2-decision-4 allowlist for in-place
 * cross-provider switches. `isCrossKindSwitchAllowed` does not exist yet,
 * so this file fails at import until Phase 2 implements it.
 *
 * Scope rule: a kind change is allowed iff BOTH sides are in
 * { claude-code, codex, muse, grok-build }. Gemini anywhere on a kind change
 * stays blocked; same-kind is trivially allowed.
 */
describe('isCrossKindSwitchAllowed (cross-provider switch scope)', () => {
  let project;
  let anthropicProvider;
  let openaiProvider;
  let metaProvider;
  let googleProvider;
  let xaiProvider;

  const CLAUDE_A = 'claude-allowlist-a';
  const CLAUDE_B = 'claude-allowlist-b';
  const GPT_A = 'gpt-allowlist-a';
  const MUSE_A = 'muse-allowlist-a';
  const GEMINI_A = 'gemini-allowlist-a';
  const GROK_A = 'grok-allowlist-a';
  const GROK_B = 'grok-allowlist-b';

  beforeEach(() => {
    project = projects.create('Allowlist Test Project', '/tmp/allowlist-test');

    anthropicProvider = modelProviders.create({
      name: 'Anthropic Allowlist',
      baseUrl: 'https://api.anthropic.allowlist',
      authToken: 'key-a',
      kind: 'anthropic',
    });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_A, displayName: 'Claude A', tier: 'sonnet' });
    modelProviders.addModel(anthropicProvider.id, { modelId: CLAUDE_B, displayName: 'Claude B', tier: 'opus' });

    openaiProvider = modelProviders.create({
      name: 'OpenAI Allowlist',
      baseUrl: 'https://api.openai.allowlist',
      authToken: 'key-o',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, { modelId: GPT_A, displayName: 'GPT A', tier: 'custom' });

    metaProvider = modelProviders.create({
      name: 'Meta Allowlist',
      baseUrl: null,
      authToken: null,
      kind: 'meta',
    });
    modelProviders.addModel(metaProvider.id, { modelId: MUSE_A, displayName: 'Muse A', tier: 'custom' });

    googleProvider = modelProviders.create({
      name: 'Google Allowlist',
      baseUrl: 'https://generativelanguage.allowlist',
      authToken: 'key-g',
      kind: 'google',
    });
    modelProviders.addModel(googleProvider.id, { modelId: GEMINI_A, displayName: 'Gemini A', tier: 'custom' });

    xaiProvider = modelProviders.create({
      name: 'xAI Allowlist',
      baseUrl: null,
      authToken: null,
      kind: 'xai',
    });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_A, displayName: 'Grok A', tier: 'custom' });
    modelProviders.addModel(xaiProvider.id, { modelId: GROK_B, displayName: 'Grok B', tier: 'custom' });
  });

  afterEach(() => {
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(anthropicProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(metaProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(googleProvider.id); } catch { /* noop */ }
    try { modelProviders.delete(xaiProvider.id); } catch { /* noop */ }
    try { projects.delete(project.id); } catch { /* noop */ }
  });

  it('scopes the switch to claude-code, codex, muse, grok-build, and gemini', () => {
    expect([...IN_SCOPE_SWITCH_KINDS].sort()).toEqual(['claude-code', 'codex', 'gemini', 'grok-build', 'muse']);
  });

  it('allows codex <-> claude-code in both directions', () => {
    expect(isCrossKindSwitchAllowed('codex', CLAUDE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('claude-code', GPT_A)).toBe(true);
  });

  it('allows every direction involving muse', () => {
    expect(isCrossKindSwitchAllowed('claude-code', MUSE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('muse', CLAUDE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('codex', MUSE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('muse', GPT_A)).toBe(true);
  });

  it('allows every direction involving grok-build', () => {
    expect(isCrossKindSwitchAllowed('claude-code', GROK_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('grok-build', CLAUDE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('codex', GROK_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('grok-build', GPT_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('muse', GROK_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('grok-build', MUSE_A)).toBe(true);
  });

  it('allows any kind change involving gemini, either direction', () => {
    expect(isCrossKindSwitchAllowed('claude-code', GEMINI_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('gemini', CLAUDE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('codex', GEMINI_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('gemini', GPT_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('muse', GEMINI_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('gemini', MUSE_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('grok-build', GEMINI_A)).toBe(true);
    expect(isCrossKindSwitchAllowed('gemini', GROK_A)).toBe(true);
  });

  it('allows same-kind Grok model changes', () => {
    expect(isCrossKindSwitchAllowed('grok-build', GROK_B)).toBe(true);
  });

  it('allows same-kind model changes (existing behavior pinned)', () => {
    expect(isCrossKindSwitchAllowed('claude-code', CLAUDE_B)).toBe(true);
    expect(isCrossKindSwitchAllowed('gemini', GEMINI_A)).toBe(true);
  });

  it('falls back to claude-code resolution for null/unknown models without crashing', () => {
    expect(isCrossKindSwitchAllowed('claude-code', null)).toBe(true);
    expect(isCrossKindSwitchAllowed('claude-code', 'no-such-model-xyz')).toBe(true);
    expect(() => isCrossKindSwitchAllowed('codex', null)).not.toThrow();
    expect(() => isCrossKindSwitchAllowed('codex', undefined)).not.toThrow();
  });
});
