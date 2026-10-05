import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from '../sessions.js';

vi.mock('../../composables/useApi.js', () => ({
  api: {
    stopSession: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

describe('sessionActions stopping flag', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionsStore();
    store.sessions = [{ id: 'sess-1', status: 'running', stopping: false }];
    store.currentSession = { id: 'sess-1', status: 'running', stopping: false };
    store.error = null;
    vi.clearAllMocks();
  });

  it('stopSession records the server-reported stopping flag', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.stopSession.mockResolvedValue({ success: true, stopping: true });

    await store.stopSession('sess-1');

    expect(store.currentSession).toMatchObject({ status: 'stopped', stopping: true });
    expect(store.sessions[0]).toMatchObject({ status: 'stopped', stopping: true });
  });

  it('stopSession clears stopping when the provider already settled', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.stopSession.mockResolvedValue({ success: true, stopping: false });

    await store.stopSession('sess-1');

    expect(store.currentSession).toMatchObject({ status: 'stopped', stopping: false });
  });

  it('updateSessionStatus clears stopping on running/waiting/error but preserves it on stopped', () => {
    store.updateSessionStatus('sess-1', 'stopped');
    expect(store.currentSession.stopping).toBe(false);

    store._updateSessionInAllLists('sess-1', { status: 'stopped', stopping: true });
    store.updateSessionStatus('sess-1', 'stopped');
    expect(store.currentSession.stopping).toBe(true);

    store.updateSessionStatus('sess-1', 'running');
    expect(store.currentSession.stopping).toBe(false);

    store._updateSessionInAllLists('sess-1', { stopping: true });
    store.updateSessionStatus('sess-1', 'waiting');
    expect(store.currentSession.stopping).toBe(false);

    store._updateSessionInAllLists('sess-1', { stopping: true });
    store.updateSessionStatus('sess-1', 'error');
    expect(store.currentSession.stopping).toBe(false);
  });

  it('sendMessage clears stopping when the new turn starts', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.sendMessage.mockResolvedValue({});
    store._updateSessionInAllLists('sess-1', { status: 'stopped', stopping: true });

    await store.sendMessage('sess-1', 'hello');

    expect(store.currentSession).toMatchObject({ status: 'running', stopping: false });
  });
});
