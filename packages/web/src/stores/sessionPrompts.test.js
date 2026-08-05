import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../composables/useApi.js', () => ({ api: { getSessionPrompt: vi.fn(), respondToSessionPrompt: vi.fn() } }));
vi.mock('./ui.js', () => ({ useUiStore: () => ({ warning: vi.fn(), error: vi.fn() }) }));

import { api } from '../composables/useApi.js';
import { useSessionPromptsStore } from './sessionPrompts.js';

const prompt = { id: 'new-prompt', sessionId: 'session-1', kind: 'question' };

describe('sessionPrompts hydration ordering', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('does not let a stale hydration response overwrite a newer websocket prompt', async () => {
    let resolveRequest;
    api.getSessionPrompt.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const store = useSessionPromptsStore();
    const hydration = store.hydrate('session-1');
    store.show(prompt);
    resolveRequest(null);
    await hydration;
    expect(store.promptFor('session-1')).toEqual(prompt);
  });

  it('applies hydration when no newer websocket mutation arrives', async () => {
    api.getSessionPrompt.mockResolvedValue(prompt);
    const store = useSessionPromptsStore();
    await store.hydrate('session-1');
    expect(store.promptFor('session-1')).toEqual(prompt);
  });

  it('keeps prompts and clears scoped to their sessions', () => {
    const store = useSessionPromptsStore();
    const other = { ...prompt, id: 'other-prompt', sessionId: 'session-2' };
    store.show(prompt);
    store.show(other);
    expect(store.promptFor('session-1')).toEqual(prompt);
    expect(store.promptFor('session-2')).toEqual(other);
    store.clear('session-1');
    expect(store.promptFor('session-1')).toBeNull();
    expect(store.promptFor('session-2')).toEqual(other);
  });

  it('does not restore an in-flight hydration after its session is cleared', async () => {
    let resolveRequest;
    api.getSessionPrompt.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const store = useSessionPromptsStore();
    const hydration = store.hydrate('session-1');
    store.clear('session-1');
    resolveRequest(prompt);
    await hydration;
    expect(store.promptFor('session-1')).toBeNull();
  });

  it('submits only the prompt belonging to the specified session', async () => {
    const store = useSessionPromptsStore();
    store.show(prompt);
    store.show({ ...prompt, id: 'other-prompt', sessionId: 'session-2' });
    await store.respond('session-2', { action: 'cancel' });
    expect(api.respondToSessionPrompt).toHaveBeenCalledWith('session-2', 'other-prompt', { action: 'cancel' });
    await store.respond('missing-session', { action: 'cancel' });
    expect(api.respondToSessionPrompt).toHaveBeenCalledTimes(1);
  });

  it('only resolves the matching prompt in the specified session', () => {
    const store = useSessionPromptsStore();
    const other = { ...prompt, id: 'other-prompt', sessionId: 'session-2' };
    store.show(prompt); store.show(other);
    store.resolved('wrong-id', 'session-1');
    expect(store.promptFor('session-1')).toEqual(prompt);
    store.resolved('new-prompt', 'session-1');
    expect(store.promptFor('session-1')).toBeNull();
    expect(store.promptFor('session-2')).toEqual(other);
  });
});
