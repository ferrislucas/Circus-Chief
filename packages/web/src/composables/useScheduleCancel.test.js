import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScheduleCancel } from './useScheduleCancel.js';

// Shared mock object so the composable and tests reference the same spies
const mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

function createMockSessionsStore() {
  return {
    updateSessionFields: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useScheduleCancel', () => {
  let sessionsStore;

  beforeEach(() => {
    sessionsStore = createMockSessionsStore();
    mockUiStore.success.mockReset();
    mockUiStore.error.mockReset();
  });

  function createCancel(overrides = {}) {
    return useScheduleCancel(overrides.store || sessionsStore);
  }

  it('returns a cancelling ref initialised to false', () => {
    const { cancelling } = createCancel();
    expect(cancelling.value).toBe(false);
  });

  it('returns a cancelScheduledSession function', () => {
    const { cancelScheduledSession } = createCancel();
    expect(typeof cancelScheduledSession).toBe('function');
  });

  describe('cancelScheduledSession', () => {
    it('shows confirm dialog before cancelling', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { cancelScheduledSession } = createCancel();

      await cancelScheduledSession('sess-1');

      expect(window.confirm).toHaveBeenCalledWith('Cancel this scheduled workspace?');
    });

    it('does not call updateSessionFields when user dismisses confirm', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { cancelScheduledSession } = createCancel();

      await cancelScheduledSession('sess-1');

      expect(sessionsStore.updateSessionFields).not.toHaveBeenCalled();
    });

    it('returns false when user dismisses confirm', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { cancelScheduledSession } = createCancel();

      const result = await cancelScheduledSession('sess-1');

      expect(result).toBe(false);
    });

    it('calls updateSessionFields with status stopped and scheduledAt null when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { cancelScheduledSession } = createCancel();

      await cancelScheduledSession('sess-1');

      expect(sessionsStore.updateSessionFields).toHaveBeenCalledWith('sess-1', {
        status: 'stopped',
        scheduledAt: null,
      });
    });

    it('shows success toast on successful cancellation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { cancelScheduledSession } = createCancel();

      await cancelScheduledSession('sess-1');

      expect(mockUiStore.success).toHaveBeenCalledWith('Workspace cancelled');
    });

    it('returns true on successful cancellation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { cancelScheduledSession } = createCancel();

      const result = await cancelScheduledSession('sess-1');

      expect(result).toBe(true);
    });

    it('sets cancelling to true during the API call', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let resolvePromise;
      sessionsStore.updateSessionFields.mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; }),
      );

      const { cancelling, cancelScheduledSession } = createCancel();
      const promise = cancelScheduledSession('sess-1');

      expect(cancelling.value).toBe(true);

      resolvePromise();
      await promise;

      expect(cancelling.value).toBe(false);
    });

    it('resets cancelling to false after successful cancellation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { cancelling, cancelScheduledSession } = createCancel();

      await cancelScheduledSession('sess-1');

      expect(cancelling.value).toBe(false);
    });

    it('shows error toast when updateSessionFields rejects', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      sessionsStore.updateSessionFields.mockRejectedValue(new Error('Network error'));

      const { cancelScheduledSession } = createCancel();
      await cancelScheduledSession('sess-1');

      expect(mockUiStore.error).toHaveBeenCalledWith('Failed to cancel workspace: Network error');
    });

    it('returns false when updateSessionFields rejects', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      sessionsStore.updateSessionFields.mockRejectedValue(new Error('fail'));

      const { cancelScheduledSession } = createCancel();
      const result = await cancelScheduledSession('sess-1');

      expect(result).toBe(false);
    });

    it('resets cancelling to false even when updateSessionFields rejects', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      sessionsStore.updateSessionFields.mockRejectedValue(new Error('fail'));

      const { cancelling, cancelScheduledSession } = createCancel();
      await cancelScheduledSession('sess-1');

      expect(cancelling.value).toBe(false);
    });
  });
});
