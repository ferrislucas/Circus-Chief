import { describe, it, expect, vi } from 'vitest';
import {
  IN_SCOPE_SWITCH_KINDS,
  agentTypeForKind,
  agentTypeForProviders,
  agentLabelForType,
  planModelSwitch,
  persistModelSelectionWithConfirm,
} from './crossKindSwitch.js';

/**
 * RED (plan Phase 5, FRD §4/G4): picking a different-kind model on a started
 * session must surface a confirmation before dispatching updateSessionModel.
 * `crossKindSwitch.js` does not exist yet, so this file fails at import
 * until the GREEN step implements it.
 */
describe('crossKindSwitch picker helper', () => {
  it('scopes confirmation to claude-code, codex, and muse', () => {
    expect([...IN_SCOPE_SWITCH_KINDS].sort()).toEqual(['claude-code', 'codex', 'muse']);
  });

  it('maps provider kinds to agent types (unknown kinds stay Claude Code)', () => {
    expect(agentTypeForKind('openai')).toBe('codex');
    expect(agentTypeForKind('google')).toBe('gemini');
    expect(agentTypeForKind('meta')).toBe('muse');
    expect(agentTypeForKind('anthropic')).toBe('claude-code');
    expect(agentTypeForKind(null)).toBe('claude-code');
    expect(agentTypeForKind('whatever')).toBe('claude-code');
  });

  it('resolves selections to agent types via explicit provider id, then model ownership', () => {
    const providers = [
      { id: 'a', kind: 'anthropic', models: [{ modelId: 'claude-x' }] },
      { id: 'o', kind: 'openai', models: [{ modelId: 'gpt-x' }] },
    ];
    expect(agentTypeForProviders(providers, 'o', 'claude-x')).toBe('codex');
    expect(agentTypeForProviders(providers, null, 'gpt-x')).toBe('codex');
    expect(agentTypeForProviders(providers, null, 'unknown')).toBe('claude-code');
    expect(agentTypeForProviders([], null, null)).toBe('claude-code');
  });

  it('labels agent types for the confirmation copy', () => {
    expect(agentLabelForType('claude-code')).toBe('Claude Code');
    expect(agentLabelForType('codex')).toBe('Codex');
    expect(agentLabelForType('gemini')).toBe('Gemini');
    expect(agentLabelForType('muse')).toBe('Muse');
  });

  it('codex→claude-code on a started session asks for confirmation with the FRD copy', () => {
    const plan = planModelSwitch({ fromAgentType: 'codex', toAgentType: 'claude-code', isStarted: true });
    expect(plan?.action).toBe('confirm');
    expect(plan.copy).toBe(
      'Switch from Codex to Claude Code? Native context is cleared; full text history is passed to the new provider.',
    );
  });

  it('claude-code→muse confirms with Muse labels', () => {
    const plan = planModelSwitch({ fromAgentType: 'claude-code', toAgentType: 'muse', isStarted: true });
    expect(plan?.action).toBe('confirm');
    expect(plan.copy).toBe(
      'Switch from Claude Code to Muse? Native context is cleared; full text history is passed to the new provider.',
    );
  });

  it('same-kind changes need no confirmation', () => {
    expect(planModelSwitch({ fromAgentType: 'claude-code', toAgentType: 'claude-code', isStarted: true })).toBeNull();
    expect(planModelSwitch({ fromAgentType: 'codex', toAgentType: 'codex', isStarted: true })).toBeNull();
  });

  it('draft sessions (not started) need no confirmation even across kinds', () => {
    expect(planModelSwitch({ fromAgentType: 'codex', toAgentType: 'claude-code', isStarted: false })).toBeNull();
  });

  it('gemini switches defer to the backend guard (no confirm copy; existing error surfaces)', () => {
    expect(planModelSwitch({ fromAgentType: 'claude-code', toAgentType: 'gemini', isStarted: true })).toEqual({
      action: 'backend',
    });
    expect(planModelSwitch({ fromAgentType: 'gemini', toAgentType: 'claude-code', isStarted: true })).toEqual({
      action: 'backend',
    });
  });
});

describe('persistModelSelectionWithConfirm', () => {
  const base = {
    oldModel: 'claude-x', oldProviderId: 'a', newModel: 'gpt-x', newProviderId: 'o',
    fromAgentType: 'claude-code', toAgentType: 'codex', isStarted: true,
  };
  const fns = () => ({
    confirmFn: vi.fn().mockReturnValue(true),
    persistFn: vi.fn().mockResolvedValue({}),
    onError: vi.fn(),
    revertFn: vi.fn(),
  });

  it('confirming persists with the new model+providerId and reverts nothing', async () => {
    const { confirmFn, persistFn, onError, revertFn } = fns();
    const result = await persistModelSelectionWithConfirm({ ...base, confirmFn, persistFn, onError, revertFn });
    expect(result).toBe('persisted');
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(persistFn).toHaveBeenCalledWith('gpt-x', 'o');
    expect(revertFn).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancelling reverts and never persists', async () => {
    const { persistFn, onError, revertFn } = fns();
    const result = await persistModelSelectionWithConfirm({
      ...base, confirmFn: () => false, persistFn, onError, revertFn,
    });
    expect(result).toBe('cancelled');
    expect(persistFn).not.toHaveBeenCalled();
    expect(revertFn).toHaveBeenCalledWith('claude-x', 'a');
  });

  it('4xx refusal surfaces the backend copy and reverts (gemini 400 shape)', async () => {
    const err = Object.assign(
      new Error('Cannot switch agent kind mid-session (Claude Code → Gemini)'),
      { status: 400 },
    );
    const { confirmFn, onError, revertFn } = fns();
    const result = await persistModelSelectionWithConfirm({
      ...base,
      fromAgentType: 'claude-code', toAgentType: 'gemini',
      confirmFn, persistFn: vi.fn().mockRejectedValue(err), onError, revertFn,
    });
    expect(result).toBe('failed');
    expect(confirmFn).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(err);
    expect(revertFn).toHaveBeenCalledWith('claude-x', 'a');
  });

  it('non-4xx failure toasts but keeps the user choice (draft submit self-heals)', async () => {
    const err = new Error('Network error');
    const { confirmFn, onError, revertFn } = fns();
    const result = await persistModelSelectionWithConfirm({
      ...base, confirmFn, persistFn: vi.fn().mockRejectedValue(err), onError, revertFn,
    });
    expect(result).toBe('failed');
    expect(onError).toHaveBeenCalledWith(err);
    expect(revertFn).not.toHaveBeenCalled();
  });

  it('same-kind changes persist without confirming', async () => {
    const { confirmFn, persistFn, onError, revertFn } = fns();
    const result = await persistModelSelectionWithConfirm({
      ...base, toAgentType: 'claude-code', confirmFn, persistFn, onError, revertFn,
    });
    expect(result).toBe('persisted');
    expect(confirmFn).not.toHaveBeenCalled();
    expect(persistFn).toHaveBeenCalledWith('gpt-x', 'o');
  });
});
