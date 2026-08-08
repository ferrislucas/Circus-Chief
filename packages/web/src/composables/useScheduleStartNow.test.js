import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { useScheduleStartNow } from './useScheduleStartNow.js';

const { mockUiStore } = vi.hoisted(() => ({
  mockUiStore: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../stores/ui.js', () => ({ useUiStore: () => mockUiStore }));

describe('useScheduleStartNow', () => {
  const session = { id: 'session-1', pendingPrompt: 'saved prompt' };
  let sessionsStore;

  function createStore() {
    // A reactive object (not a plain `{}`) so the fake `scheduleMutationInFlight`
    // getter is a real Vue reactive dependency for `startingNow`'s computed —
    // matching how the real Pinia store's state works.
    const mutations = reactive({});
    return {
      runScheduledNow: vi.fn().mockResolvedValue(undefined),
      scheduleMutationInFlight: vi.fn((id) => mutations[id] || null),
      beginScheduleMutation: vi.fn((id, kind) => {
        if (mutations[id]) return false;
        mutations[id] = kind;
        return true;
      }),
      endScheduleMutation: vi.fn((id) => { delete mutations[id]; }),
    };
  }

  beforeEach(() => {
    sessionsStore = createStore();
    vi.clearAllMocks();
  });

  it('starts with no prompt argument when the prompt override matches the persisted prompt', async () => {
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await expect(startScheduledNow(session, 'saved prompt')).resolves.toBe(true);
    expect(sessionsStore.runScheduledNow).toHaveBeenCalledWith('session-1', undefined);
    expect(mockUiStore.success).toHaveBeenCalledWith('Workspace started');
  });

  it('sends an edited prompt directly to runScheduledNow — no separate save call', async () => {
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await startScheduledNow(session, 'edited prompt');
    expect(sessionsStore.runScheduledNow).toHaveBeenCalledWith('session-1', 'edited prompt');
    expect(sessionsStore.runScheduledNow).toHaveBeenCalledTimes(1);
  });

  it('starts with no override when called with just the session', async () => {
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await startScheduledNow(session);
    expect(sessionsStore.runScheduledNow).toHaveBeenCalledWith('session-1', undefined);
  });

  it('surfaces errors and resets its loading state', async () => {
    sessionsStore.runScheduledNow.mockRejectedValue(new Error('already started'));
    const { startingNow, startScheduledNow } = useScheduleStartNow(sessionsStore, () => session.id);
    await expect(startScheduledNow(session)).resolves.toBe(false);
    expect(startingNow.value).toBe(false);
    expect(mockUiStore.error).toHaveBeenCalledWith('Failed to start workspace: already started');
  });

  it('reflects the shared store in-flight state, not a local ref', async () => {
    let resolveRun;
    sessionsStore.runScheduledNow.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
    const { startingNow, startScheduledNow } = useScheduleStartNow(sessionsStore, () => session.id);

    expect(startingNow.value).toBe(false);
    const promise = startScheduledNow(session);
    expect(startingNow.value).toBe(true);
    expect(sessionsStore.beginScheduleMutation).toHaveBeenCalledWith('session-1', 'starting');

    resolveRun();
    await promise;
    expect(startingNow.value).toBe(false);
    expect(sessionsStore.endScheduleMutation).toHaveBeenCalledWith('session-1');
  });

  it('bails out without calling the API when another mutation is already in flight for the session', async () => {
    sessionsStore.beginScheduleMutation.mockReturnValue(false);
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);

    await expect(startScheduledNow(session)).resolves.toBe(false);
    expect(sessionsStore.runScheduledNow).not.toHaveBeenCalled();
  });

  it('returns false without calling the API when the session has no id', async () => {
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await expect(startScheduledNow({})).resolves.toBe(false);
    expect(sessionsStore.runScheduledNow).not.toHaveBeenCalled();
  });
});
