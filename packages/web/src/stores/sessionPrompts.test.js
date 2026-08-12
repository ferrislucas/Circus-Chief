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
    expect(store.promptFor('session-2')).toBeNull();
    expect(store.promptFor('session-1')).toEqual(prompt);
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

// Opening a session view mounts several independent consumers
// (ConversationTab, SessionChatContent, useSessionInitializer's reconnect
// handler) that each call `hydrate(sessionId)` on their own lifecycle hook.
// Rather than picking a single fragile "owner" component — easy to regress
// as the view tree is refactored — concurrent calls for the same session
// collapse into the one in-flight request, so opening a session view still
// issues exactly one `GET /prompt` round-trip no matter how many consumers
// are mounted.
describe('sessionPrompts hydration de-duplication', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); });

  it('issues exactly one request when multiple consumers hydrate the same session concurrently', async () => {
    let resolveRequest;
    api.getSessionPrompt.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const store = useSessionPromptsStore();

    const first = store.hydrate('session-1');
    const second = store.hydrate('session-1');
    const third = store.hydrate('session-1');

    expect(api.getSessionPrompt).toHaveBeenCalledTimes(1);
    resolveRequest(prompt);
    await Promise.all([first, second, third]);

    expect(api.getSessionPrompt).toHaveBeenCalledTimes(1);
    expect(store.promptFor('session-1')).toEqual(prompt);
  });

  it('keeps concurrent hydration de-duplication scoped per session', async () => {
    api.getSessionPrompt.mockImplementation((sessionId) =>
      Promise.resolve(sessionId === 'session-1' ? prompt : { ...prompt, id: 'other', sessionId }));
    const store = useSessionPromptsStore();

    await Promise.all([store.hydrate('session-1'), store.hydrate('session-2')]);

    expect(api.getSessionPrompt).toHaveBeenCalledTimes(2);
    expect(store.promptFor('session-1')).toEqual(prompt);
    expect(store.promptFor('session-2')?.sessionId).toBe('session-2');
  });

  it('issues a fresh request for a later hydration once the in-flight one has settled', async () => {
    api.getSessionPrompt.mockResolvedValue(prompt);
    const store = useSessionPromptsStore();

    await store.hydrate('session-1');
    await store.hydrate('session-1');

    expect(api.getSessionPrompt).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight marker even when the request rejects, so a retry can still issue a request', async () => {
    api.getSessionPrompt.mockRejectedValueOnce(new Error('network error'));
    const store = useSessionPromptsStore();

    await expect(store.hydrate('session-1')).rejects.toThrow('network error');

    api.getSessionPrompt.mockResolvedValueOnce(prompt);
    await store.hydrate('session-1');
    expect(store.promptFor('session-1')).toEqual(prompt);
  });
});
