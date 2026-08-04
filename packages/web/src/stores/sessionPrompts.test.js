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
    expect(store.prompt).toEqual(prompt);
  });

  it('applies hydration when no newer websocket mutation arrives', async () => {
    api.getSessionPrompt.mockResolvedValue(prompt);
    const store = useSessionPromptsStore();
    await store.hydrate('session-1');
    expect(store.prompt).toEqual(prompt);
  });
});
