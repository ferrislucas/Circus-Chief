import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScheduleStartNow } from './useScheduleStartNow.js';

const { mockUiStore, mockApi } = vi.hoisted(() => ({
  mockUiStore: { success: vi.fn(), error: vi.fn() },
  mockApi: { updateSessionPendingPrompt: vi.fn() },
}));

vi.mock('../stores/ui.js', () => ({ useUiStore: () => mockUiStore }));
vi.mock('./useApi.js', () => ({ api: mockApi }));

describe('useScheduleStartNow', () => {
  const session = { id: 'session-1', pendingPrompt: 'saved prompt' };
  let sessionsStore;

  beforeEach(() => {
    sessionsStore = { runScheduledNow: vi.fn().mockResolvedValue(undefined) };
    vi.clearAllMocks();
    mockApi.updateSessionPendingPrompt.mockResolvedValue(undefined);
  });

  it('starts immediately without saving when the prompt is unchanged', async () => {
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await expect(startScheduledNow(session, 'saved prompt')).resolves.toBe(true);
    expect(mockApi.updateSessionPendingPrompt).not.toHaveBeenCalled();
    expect(sessionsStore.runScheduledNow).toHaveBeenCalledWith('session-1');
    expect(mockUiStore.success).toHaveBeenCalledWith('Workspace started');
  });

  it('saves an edited prompt before starting', async () => {
    const calls = [];
    mockApi.updateSessionPendingPrompt.mockImplementation(async () => calls.push('save'));
    sessionsStore.runScheduledNow.mockImplementation(async () => calls.push('start'));
    const { startScheduledNow } = useScheduleStartNow(sessionsStore);
    await startScheduledNow(session, 'edited prompt');
    expect(mockApi.updateSessionPendingPrompt).toHaveBeenCalledWith('session-1', 'edited prompt');
    expect(calls).toEqual(['save', 'start']);
  });

  it('surfaces errors and resets its loading state', async () => {
    sessionsStore.runScheduledNow.mockRejectedValue(new Error('already started'));
    const { startingNow, startScheduledNow } = useScheduleStartNow(sessionsStore);
    await expect(startScheduledNow(session)).resolves.toBe(false);
    expect(startingNow.value).toBe(false);
    expect(mockUiStore.error).toHaveBeenCalledWith('Failed to start workspace: already started');
  });
});
