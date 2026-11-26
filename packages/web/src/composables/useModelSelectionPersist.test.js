import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useModelSelectionPersist } from './useModelSelectionPersist.js';

const tierStore = vi.hoisted(() => ({ tiers: [], fetchTiers: vi.fn() }));
vi.mock('../stores/tiers.js', () => ({ useTiersStore: () => tierStore }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const model = ref('sonnet');
  const provider = ref('anthropic');
  const sessionId = ref('one');
  const sessions = { currentSession: { id: 'one', agentType: 'claude-code' }, isDraftSession: () => false, updateSessionModel: vi.fn().mockResolvedValue() };
  const scope = effectScope();
  const result = scope.run(() => useModelSelectionPersist({
    getSessionId: () => sessionId.value, selectedModel: model, selectedProviderId: provider,
    sessionsStore: sessions, providersStore: { providers: [
      { id: 'anthropic', kind: 'anthropic', models: [{ modelId: 'sonnet' }, { modelId: 'opus' }] },
      { id: 'openai', kind: 'openai', models: [{ modelId: 'gpt' }] },
    ] }, uiStore: { error: vi.fn() },
  }));
  return { model, provider, sessionId, sessions, scope, ...result };
}
const tier = (id, providerId, modelId) => [{ id, members: [{ providerId, modelId }] }];

describe('selection persistence ordering', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

  it('blocks submission immediately while a tier lookup is pending and restores the accepted selection on cancel', async () => {
    const pending = deferred(); tierStore.fetchTiers.mockReturnValue(pending.promise);
    window.confirm.mockReturnValue(false);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    expect(s.selectionPending.value).toBe(true);
    await nextTick();
    pending.resolve(tier('a', 'openai', 'gpt'));
    await vi.waitFor(() => expect(s.model.value).toBe('sonnet'));
    expect(s.provider.value).toBe('anthropic');
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    expect(s.selectionPending.value).toBe(false);
    s.scope.stop();
  });

  it.each(['openai', 'anthropic'])('does not persist an older tier after a newer model (%s)', async (kind) => {
    const pending = deferred(); tierStore.fetchTiers.mockReturnValue(pending.promise);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    s.model.value = 'opus'; s.provider.value = 'anthropic';
    await nextTick();
    pending.resolve(tier('a', kind, kind === 'openai' ? 'gpt' : 'sonnet'));
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalled());
    await Promise.resolve();
    expect(s.sessions.updateSessionModel).toHaveBeenCalledTimes(1);
    expect(s.sessions.updateSessionModel).toHaveBeenCalledWith('one', 'opus', 'anthropic');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(s.model.value).toBe('opus');
    s.scope.stop();
  });

  it.each(['session change', 'disposal'])('abandons a lookup on %s', async (action) => {
    const pending = deferred(); tierStore.fetchTiers.mockReturnValue(pending.promise);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    if (action === 'session change') s.sessionId.value = 'two';
    else s.scope.stop();
    pending.resolve(tier('a', 'openai', 'gpt'));
    await nextTick(); await Promise.resolve();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    s.scope.stop();
  });
  it('keeps the newer tier when lookups finish out of order', async () => {
    const a = deferred(); const b = deferred();
    tierStore.fetchTiers.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    s.model.value = 'tier::b';
    await nextTick();
    b.resolve(tier('b', 'anthropic', 'opus'));
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledTimes(1));
    a.resolve(tier('a', 'openai', 'gpt'));
    await nextTick(); await Promise.resolve();
    expect(s.sessions.updateSessionModel).toHaveBeenCalledTimes(1);
    expect(s.model.value).toBe('tier::b');
    expect(window.confirm).not.toHaveBeenCalled();
    s.scope.stop();
  });

  it('keeps a newer accepted choice when an earlier PATCH rejects', async () => {
    const patch = deferred();
    const s = setup();
    s.sessions.updateSessionModel.mockReturnValueOnce(patch.promise);
    s.model.value = 'opus';
    await nextTick();
    s.model.value = 'gpt'; s.provider.value = 'openai';
    await nextTick();
    patch.reject(Object.assign(new Error('rejected'), { status: 400 }));
    await nextTick(); await Promise.resolve();
    expect(s.model.value).toBe('gpt');
    expect(s.provider.value).toBe('openai');
    s.scope.stop();
  });

  it('restores the accepted binding if tier lookup rejects', async () => {
    tierStore.fetchTiers.mockRejectedValue(new Error('offline'));
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await vi.waitFor(() => expect(s.model.value).toBe('sonnet'));
    expect(s.selectionPending.value).toBe(false);
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    s.scope.stop();
  });

});
