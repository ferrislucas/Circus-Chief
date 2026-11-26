import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useTiersStore } from '../stores/tiers.js';
import { useModelSelectionPersist } from './useModelSelectionPersist.js';
import { useFollowUpModel } from './useFollowUpModel.js';

const mockApi = vi.hoisted(() => ({ getTiers: vi.fn() }));
vi.mock('./useApi.js', () => ({ api: mockApi }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(catalog) {
  const model = ref('sonnet');
  const provider = ref('anthropic');
  const sessionId = ref('one');
  const sessions = { currentSession: { id: 'one', agentType: 'claude-code' }, isDraftSession: () => false, updateSessionModel: vi.fn().mockResolvedValue() };
  const ui = { error: vi.fn() };
  const providers = { providers: catalog ?? [
    { id: 'anthropic', kind: 'anthropic', models: [{ modelId: 'sonnet' }, { modelId: 'opus' }] },
    { id: 'openai', kind: 'openai', models: [{ modelId: 'gpt' }] },
  ] };
  const scope = effectScope();
  const result = scope.run(() => useModelSelectionPersist({
    getSessionId: () => sessionId.value, selectedModel: model, selectedProviderId: provider,
    sessionsStore: sessions, providersStore: providers, uiStore: ui,
  }));
  return { model, provider, sessionId, sessions, providers, ui, scope, ...result };
}
const tier = (id, providerId, modelId) => [{ id, members: [{ providerId, modelId }] }];

describe('selection persistence ordering', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

  it('preserves implicit follow-up intent after cancelling a selection', async () => {
    const model = ref(null); const provider = ref(null);
    const sessions = { currentSession: { id: 'one', projectId: 'p', model: null, agentType: 'claude-code' },
      isDraftSession: () => false, updateSessionModel: vi.fn().mockResolvedValue() };
    const providers = { providers: [
      { id: 'openai', kind: 'openai', models: [{ modelId: 'gpt' }] },
      { id: 'google', kind: 'google', models: [{ modelId: 'gemini' }] },
    ] };
    const scope = effectScope();
    let revert = () => {};
    const { persist: persistence, follow: followUp } = scope.run(() => {
      const persist = useModelSelectionPersist({ getSessionId: () => 'one', selectedModel: model,
        selectedProviderId: provider, sessionsStore: sessions, providersStore: providers,
        uiStore: { error: vi.fn() }, onRevert: (...args) => revert(...args) });
      const follow = useFollowUpModel({ getSessionId: () => 'one', sessionsStore: sessions,
        providersStore: providers, defaultsStore: { getDefaultsForProject: () => ({ model: 'gpt', providerId: 'openai' }) },
        selectedModel: model, selectedProviderId: provider, ...persist });
      revert = follow.onModelPickReverted;
      return { persist, follow };
    });
    await nextTick(); await nextTick();
    expect(followUp.followUpSelection()).toEqual({ model: null, providerId: null });
    window.confirm.mockReturnValue(false);
    model.value = 'gemini'; provider.value = 'google'; followUp.onUserModelSelected();
    await vi.waitFor(() => expect(model.value).toBe('gpt'));
    expect(followUp.followUpSelection()).toEqual({ model: null, providerId: null });
    expect(sessions.updateSessionModel).not.toHaveBeenCalled();
    expect(persistence.selectionPending.value).toBe(false);
    scope.stop();
  });

  it.each([[false, 'failure'], [true, 'failure'], [true, 'cancel']])('restores explicit intent %s after tier %s', async (explicit, outcome) => {
    const model = ref(null); const provider = ref(null); const errors = vi.fn();
    const sessions = { currentSession: { id: 'one', projectId: 'p', model: null, agentType: 'claude-code' },
      isDraftSession: () => false, updateSessionModel: vi.fn().mockResolvedValue() };
    const providers = { providers: [
      { id: 'openai', kind: 'openai', models: [{ modelId: 'gpt' }] },
      { id: 'anthropic', kind: 'anthropic', models: [{ modelId: 'opus' }] },
    ] };
    const scope = effectScope(); let revert = () => {};
    const follow = scope.run(() => {
      const persist = useModelSelectionPersist({ getSessionId: () => 'one', selectedModel: model,
        selectedProviderId: provider, sessionsStore: sessions, providersStore: providers,
        uiStore: { error: errors }, onRevert: (...args) => revert(...args) });
      const result = useFollowUpModel({ getSessionId: () => 'one', sessionsStore: sessions,
        providersStore: providers, defaultsStore: { getDefaultsForProject: () => ({ model: 'gpt', providerId: 'openai' }) },
        selectedModel: model, selectedProviderId: provider, ...persist });
      revert = result.onModelPickReverted; return result;
    });
    await nextTick(); await nextTick();
    if (explicit) {
      model.value = 'opus'; provider.value = 'anthropic'; follow.onUserModelSelected();
      await vi.waitFor(() => expect(sessions.updateSessionModel).toHaveBeenCalledOnce());
    }
    if (outcome === 'failure') mockApi.getTiers.mockRejectedValue(new Error('offline'));
    else { mockApi.getTiers.mockResolvedValue(tier('a', 'openai', 'gpt')); window.confirm.mockReturnValue(false); }
    model.value = 'tier::a'; provider.value = null; follow.onUserModelSelected();
    if (outcome === 'failure') await vi.waitFor(() => expect(errors).toHaveBeenCalledWith('offline'));
    else await vi.waitFor(() => expect(model.value).toBe('opus'));
    expect(follow.followUpSelection()).toEqual(explicit
      ? { model: 'opus', providerId: 'anthropic' } : { model: null, providerId: null });
    expect(model.value).toBe(explicit ? 'opus' : 'gpt');
    scope.stop();
  });

  it('persists the tier after confirming against the completed earlier switch', async () => {
    const patch = deferred(); const lookup = deferred();
    mockApi.getTiers.mockReturnValue(lookup.promise);
    const s = setup(); s.sessions.updateSessionModel.mockReturnValueOnce(patch.promise);
    s.model.value = 'gpt'; s.provider.value = 'openai';
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledOnce());
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick(); lookup.resolve(tier('a', 'anthropic', 'sonnet'));
    s.sessions.currentSession = { id: 'one', agentType: 'codex' }; patch.resolve();
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledTimes(2));
    expect(window.confirm.mock.calls[1][0]).toContain('Switch from Codex to Claude Code?');
    expect(s.sessions.updateSessionModel).toHaveBeenLastCalledWith('one', 'tier::a', null);
    s.scope.stop();
  });

  it('uses the refreshed draft state after a tier lookup', async () => {
    const lookup = deferred(); mockApi.getTiers.mockReturnValue(lookup.promise);
    const s = setup(); s.sessions.isDraftSession = (session) => session.draft;
    s.model.value = 'tier::a'; s.provider.value = null; await nextTick();
    s.sessions.currentSession = { id: 'one', agentType: 'claude-code', draft: true };
    lookup.resolve(tier('a', 'openai', 'gpt'));
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledOnce());
    expect(window.confirm).not.toHaveBeenCalled(); s.scope.stop();
  });

  it.each(['lookup first', 'patch first'])('waits for an earlier patch before deciding the tier switch (%s)', async (order) => {
    const patch = deferred(); const lookup = deferred();
    mockApi.getTiers.mockReturnValue(lookup.promise);
    const s = setup();
    s.sessions.updateSessionModel.mockReturnValueOnce(patch.promise);
    s.model.value = 'gpt'; s.provider.value = 'openai';
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledOnce());
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    window.confirm.mockReturnValue(false);
    if (order === 'lookup first') { lookup.resolve(tier('a', 'anthropic', 'sonnet')); await nextTick(); await Promise.resolve(); }
    s.sessions.currentSession = { id: 'one', agentType: 'codex' };
    patch.resolve();
    if (order === 'patch first') lookup.resolve(tier('a', 'anthropic', 'sonnet'));
    await vi.waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(2));
    expect(window.confirm.mock.calls[1][0]).toContain('Switch from Codex to Claude Code?');
    await vi.waitFor(() => expect(s.selectionPending.value).toBe(false));
    expect(s.sessions.updateSessionModel).toHaveBeenCalledTimes(1);
    expect(s.model.value).toBe('gpt');
    s.scope.stop();
  });

  it('blocks submission immediately while a tier lookup is pending and restores the accepted selection on cancel', async () => {
    const pending = deferred(); mockApi.getTiers.mockReturnValue(pending.promise);
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

  it.each([
    [false, []],
    [true, []],
    [false, [{ id: 'other', kind: 'anthropic', models: [{ modelId: 'gpt' }] }]],
  ])('confirms an unresolved tier before persistence (accept: %s)', async (accept, catalog) => {
    mockApi.getTiers.mockResolvedValue(tier('a', 'openai', 'gpt'));
    window.confirm.mockReturnValue(accept);
    const s = setup(catalog);
    s.model.value = 'tier::a'; s.provider.value = null;
    await vi.waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(window.confirm).toHaveBeenCalledWith('Switch model? Native context is cleared; full text history is passed to the new provider.');
    await vi.waitFor(() => expect(s.selectionPending.value).toBe(false));
    if (accept) {
      expect(s.sessions.updateSessionModel).toHaveBeenCalledExactlyOnceWith('one', 'tier::a', null);
    } else {
      expect(s.model.value).toBe('sonnet');
      expect(s.provider.value).toBe('anthropic');
      expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    }
    s.scope.stop();
  });

  it.each([
    ['added', [], [{ id: 'openai', kind: 'openai' }], 'Switch from Claude Code to Codex?'],
    ['removed', [{ id: 'openai', kind: 'openai' }], [], 'Switch model?'],
  ])('uses the provider catalog %s during a tier refresh', async (_label, initial, refreshed, copy) => {
    const pending = deferred(); mockApi.getTiers.mockReturnValue(pending.promise);
    const s = setup(initial);
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    s.providers.providers = refreshed;
    pending.resolve(tier('a', 'openai', 'gpt'));
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledOnce());
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(window.confirm.mock.calls[0][0]).toContain(copy);
    s.scope.stop();
  });

  it('confirms and saves a successful cross-kind tier selection', async () => {
    mockApi.getTiers.mockResolvedValue(tier('a', 'openai', 'gpt'));
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledWith('one', 'tier::a', null));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(s.selectionPending.value).toBe(false);
    s.scope.stop();
  });

  it.each(['openai', 'anthropic'])('does not persist an older tier after a newer model (%s)', async (kind) => {
    const pending = deferred(); mockApi.getTiers.mockReturnValue(pending.promise);
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

  it.each(['session change', 'disposal'])('abandons a failed lookup on %s', async (action) => {
    const pending = deferred(); mockApi.getTiers.mockReturnValue(pending.promise);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    if (action === 'session change') s.sessionId.value = 'two';
    else s.scope.stop();
    pending.reject(new Error('offline'));
    await nextTick(); await Promise.resolve();
    expect(s.ui.error).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    s.scope.stop();
  });
  it('keeps the newer tier when lookups finish out of order', async () => {
    const a = deferred(); const b = deferred();
    mockApi.getTiers.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
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

  it('rejects a failed selection refresh even when a concurrent refresh succeeds', async () => {
    const selection = deferred(); const other = deferred();
    mockApi.getTiers.mockReturnValueOnce(selection.promise).mockReturnValueOnce(other.promise);
    const store = useTiersStore();
    store.tiers = [{ id: 'a', members: [
      { providerId: 'anthropic', modelId: 'sonnet', available: true },
      { providerId: 'openai', modelId: 'gpt', available: true },
    ] }];
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    const refresh = store.fetchTiers();
    other.resolve(store.tiers);
    await refresh;
    selection.reject(new Error('offline'));
    await vi.waitFor(() => expect(s.model.value).toBe('sonnet'));
    await nextTick(); await Promise.resolve();
    expect(s.provider.value).toBe('anthropic');
    expect(s.ui.error).toHaveBeenCalledWith('offline');
    expect(s.selectionPending.value).toBe(false);
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    s.scope.stop();
  });

  it('ignores a late failed refresh while a newer selection is pending', async () => {
    const first = deferred(); const second = deferred();
    mockApi.getTiers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await nextTick();
    s.model.value = 'tier::b';
    await nextTick();
    first.reject(new Error('offline'));
    await nextTick(); await Promise.resolve();
    expect(s.model.value).toBe('tier::b');
    expect(s.selectionPending.value).toBe(true);
    expect(s.ui.error).not.toHaveBeenCalled();
    second.resolve(tier('b', 'anthropic', 'opus'));
    await vi.waitFor(() => expect(s.sessions.updateSessionModel).toHaveBeenCalledWith('one', 'tier::b', null));
    s.scope.stop();
  });

  it('restores the accepted binding if tier lookup rejects', async () => {
    mockApi.getTiers.mockRejectedValue(new Error('offline'));
    const s = setup();
    s.model.value = 'tier::a'; s.provider.value = null;
    await vi.waitFor(() => expect(s.model.value).toBe('sonnet'));
    expect(s.selectionPending.value).toBe(false);
    expect(s.sessions.updateSessionModel).not.toHaveBeenCalled();
    s.scope.stop();
  });

});
