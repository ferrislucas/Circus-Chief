import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from '../sessions.js';

vi.mock('../../composables/useApi.js', () => ({
  api: {
    runScheduledNow: vi.fn(),
  },
}));

describe('runScheduledNow action', () => {
  let store;

  beforeEach(async () => {
    setActivePinia(createPinia());
    store = useSessionsStore();
    store.sessions = [{ id: 'sess-1', status: 'scheduled', scheduledAt: 12345, pendingPrompt: 'saved prompt' }];
    store.error = null;
    vi.clearAllMocks();
    const { api } = await import('../../composables/useApi.js');
    api.runScheduledNow.mockReset();
  });

  it('calls the API with no body when no prompt override is given', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.runScheduledNow.mockResolvedValue({ id: 'sess-1', status: 'starting', scheduledAt: null, pendingPrompt: null });

    await store.runScheduledNow('sess-1');

    expect(api.runScheduledNow).toHaveBeenCalledWith('sess-1', undefined);
  });

  it('forwards a prompt override directly to the API — single call, not a preceding save', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.runScheduledNow.mockResolvedValue({ id: 'sess-1', status: 'starting' });

    await store.runScheduledNow('sess-1', 'edited prompt');

    expect(api.runScheduledNow).toHaveBeenCalledTimes(1);
    expect(api.runScheduledNow).toHaveBeenCalledWith('sess-1', { prompt: 'edited prompt' });
  });

  it('applies the returned session to the session list', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.runScheduledNow.mockResolvedValue({ id: 'sess-1', status: 'starting', scheduledAt: null, pendingPrompt: null });

    await store.runScheduledNow('sess-1');

    const updated = store.sessions.find((s) => s.id === 'sess-1');
    expect(updated.status).toBe('starting');
    expect(updated.scheduledAt).toBeNull();
    expect(updated.pendingPrompt).toBeNull();
  });

  it('sets store.error and rethrows when the API call fails', async () => {
    const { api } = await import('../../composables/useApi.js');
    api.runScheduledNow.mockRejectedValue(new Error('Session has no pending scheduled turn'));

    await expect(store.runScheduledNow('sess-1')).rejects.toThrow('Session has no pending scheduled turn');
    expect(store.error).toBe('Session has no pending scheduled turn');
  });
});

describe('schedule mutation coordination (beginScheduleMutation/endScheduleMutation/scheduleMutationInFlight)', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionsStore();
  });

  it('reports no mutation in flight for a session by default', () => {
    expect(store.scheduleMutationInFlight('sess-1')).toBeNull();
  });

  it('begin claims the slot and reports the kind via scheduleMutationInFlight', () => {
    expect(store.beginScheduleMutation('sess-1', 'starting')).toBe(true);
    expect(store.scheduleMutationInFlight('sess-1')).toBe('starting');
  });

  it('a second begin for the same session fails while the first is in flight', () => {
    expect(store.beginScheduleMutation('sess-1', 'starting')).toBe(true);
    expect(store.beginScheduleMutation('sess-1', 'cancelling')).toBe(false);
    // The original claim's kind is preserved, not overwritten by the failed attempt.
    expect(store.scheduleMutationInFlight('sess-1')).toBe('starting');
  });

  it('end releases the slot, allowing a subsequent begin to succeed', () => {
    store.beginScheduleMutation('sess-1', 'starting');
    store.endScheduleMutation('sess-1');

    expect(store.scheduleMutationInFlight('sess-1')).toBeNull();
    expect(store.beginScheduleMutation('sess-1', 'cancelling')).toBe(true);
  });

  it('end is a safe no-op when nothing is in flight', () => {
    expect(() => store.endScheduleMutation('sess-1')).not.toThrow();
    expect(store.scheduleMutationInFlight('sess-1')).toBeNull();
  });

  it('tracks different sessions independently', () => {
    store.beginScheduleMutation('sess-1', 'starting');

    expect(store.scheduleMutationInFlight('sess-1')).toBe('starting');
    expect(store.scheduleMutationInFlight('sess-2')).toBeNull();
    expect(store.beginScheduleMutation('sess-2', 'cancelling')).toBe(true);
  });

  it('begin/scheduleMutationInFlight are no-ops/null for a falsy session id', () => {
    expect(store.beginScheduleMutation(undefined, 'starting')).toBe(false);
    expect(store.scheduleMutationInFlight(null)).toBeNull();
    expect(store.scheduleMutationInFlight(undefined)).toBeNull();
  });
});
