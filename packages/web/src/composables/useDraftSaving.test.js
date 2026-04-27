import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useDraftSaving } from './useDraftSaving.js';

// Mock the API module
vi.mock('./useApi.js', () => ({
  api: {
    updateSessionPendingPrompt: vi.fn().mockResolvedValue({}),
  },
}));

// Mock vue lifecycle hooks
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual,
    onUnmounted: (fn) => fn, // Don't call, just capture
  };
});

import { api } from './useApi.js';

describe('useDraftSaving', () => {
  let input;
  let canSendMessage;
  let getSessionId;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    input = ref('');
    canSendMessage = ref(true);
    getSessionId = () => 'session-123';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createDraftSaving(overrides = {}) {
    return useDraftSaving({
      input,
      canSendMessage,
      getSessionId,
      ...overrides,
    });
  }

  describe('initial state', () => {
    it('should initialize with saved status', () => {
      const { saveStatus } = createDraftSaving();
      expect(saveStatus.value).toBe('saved');
    });

    it('should initialize with empty error', () => {
      const { saveError } = createDraftSaving();
      expect(saveError.value).toBe('');
    });
  });

  describe('handleInput', () => {
    it('should sync input value immediately', () => {
      const { handleInput } = createDraftSaving();
      const event = { target: { value: 'Hello world' } };

      handleInput(event);

      expect(input.value).toBe('Hello world');
    });

    it('should mark status as unsaved immediately', () => {
      const { handleInput, saveStatus } = createDraftSaving();
      const event = { target: { value: 'Hello' } };

      handleInput(event);

      expect(saveStatus.value).toBe('unsaved');
    });

    it('should not change status from saving to unsaved', () => {
      const { handleInput, saveStatus } = createDraftSaving();
      saveStatus.value = 'saving';

      handleInput({ target: { value: 'test' } });

      expect(saveStatus.value).toBe('saving');
    });

    it('should debounce server save (500ms)', async () => {
      const { handleInput } = createDraftSaving();

      handleInput({ target: { value: 'H' } });
      handleInput({ target: { value: 'He' } });
      handleInput({ target: { value: 'Hel' } });

      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledTimes(1);
      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'Hel');
    });

    it('should not save when canSendMessage is false', async () => {
      canSendMessage.value = false;
      const { handleInput } = createDraftSaving();

      handleInput({ target: { value: 'test' } });
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });
  });

  describe('savePendingPrompt', () => {
    it('should set status to saving during API call', async () => {
      let resolvePromise;
      api.updateSessionPendingPrompt.mockImplementation(() =>
        new Promise(resolve => { resolvePromise = resolve; })
      );

      const { savePendingPrompt, saveStatus } = createDraftSaving();
      const promise = savePendingPrompt('test prompt');

      expect(saveStatus.value).toBe('saving');

      resolvePromise();
      await promise;
    });

    it('should set status to saved after successful save', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { savePendingPrompt, saveStatus } = createDraftSaving();

      await savePendingPrompt('test prompt');

      expect(saveStatus.value).toBe('saved');
    });

    it('should clear error on successful save', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { savePendingPrompt, saveError } = createDraftSaving();
      saveError.value = 'previous error';

      await savePendingPrompt('test prompt');

      expect(saveError.value).toBe('');
    });

    it('should call API with correct session ID and prompt', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { savePendingPrompt } = createDraftSaving();

      await savePendingPrompt('my prompt');

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'my prompt');
    });

    it('should set status to error on API failure', async () => {
      api.updateSessionPendingPrompt.mockRejectedValue(new Error('Network error'));
      const { savePendingPrompt, saveStatus, saveError } = createDraftSaving();

      await savePendingPrompt('test');

      expect(saveStatus.value).toBe('error');
      expect(saveError.value).toBe('Network error');
    });

    it('should not crash on save error', async () => {
      api.updateSessionPendingPrompt.mockRejectedValue(new Error('fail'));
      const { savePendingPrompt } = createDraftSaving();

      await expect(savePendingPrompt('test')).resolves.not.toThrow();
    });
  });

  describe('flush', () => {
    it('should immediately save unsaved input', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { handleInput, flush } = createDraftSaving();

      // Type something (marks status as unsaved, starts debounce timer)
      handleInput({ target: { value: 'unsaved text' } });

      // Flush before debounce fires
      flush();

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledTimes(1);
      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'unsaved text');
    });

    it('should cancel pending debounce timers', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { handleInput, flush } = createDraftSaving();

      handleInput({ target: { value: 'test' } });

      // Flush immediately
      flush();

      // Clear mock to detect any further calls
      api.updateSessionPendingPrompt.mockClear();

      // Advance past the debounce window — should NOT fire a second save
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });

    it('should not save when status is already saved', () => {
      const { flush, saveStatus } = createDraftSaving();
      expect(saveStatus.value).toBe('saved');

      flush();

      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });

    it('should save when status is saving (in-flight debounce)', () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { flush, saveStatus } = createDraftSaving();
      input.value = 'in-flight text';
      saveStatus.value = 'saving';

      flush();

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'in-flight text');
    });
  });

  describe('cleanup', () => {
    it('should clear all timers on cleanup', () => {
      const { handleInput, cleanup } = createDraftSaving();

      // Trigger a debounced save
      handleInput({ target: { value: 'test' } });

      // Cleanup before timer fires
      cleanup();

      vi.advanceTimersByTime(1000);

      // The save should not have been triggered
      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should clear pending debounce timers without calling the API', () => {
      const { handleInput, cancel } = createDraftSaving();

      handleInput({ target: { value: 'draft text' } });

      cancel();

      vi.advanceTimersByTime(1000);
      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });

    it('should reset save status to saved', () => {
      const { handleInput, cancel, saveStatus } = createDraftSaving();

      handleInput({ target: { value: 'unsaved' } });
      expect(saveStatus.value).toBe('unsaved');

      cancel();

      expect(saveStatus.value).toBe('saved');
    });

    it('should also clear the status-reset timer', async () => {
      // Schedule a save, let it complete so draftSaveTimer is armed for the
      // 2 s reset, then cancel — verify no further mutation fires afterwards.
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { handleInput, cancel, saveStatus } = createDraftSaving();

      handleInput({ target: { value: 'x' } });
      vi.advanceTimersByTime(500);
      await vi.runOnlyPendingTimersAsync();
      expect(saveStatus.value).toBe('saved');

      cancel();

      // Still saved, and no additional API calls
      api.updateSessionPendingPrompt.mockClear();
      vi.advanceTimersByTime(5000);
      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
      expect(saveStatus.value).toBe('saved');
    });
  });

  describe('debounce stale-closure guard', () => {
    it('should bail the debounce callback when input has changed', async () => {
      const { handleInput } = createDraftSaving();

      handleInput({ target: { value: 'old text' } });

      // Simulate the textarea being cleared (e.g. by handleFormSubmit on
      // successful Send) before the debounce fires.
      input.value = '';

      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // The stale debounce should not write the old value back to the server.
      expect(api.updateSessionPendingPrompt).not.toHaveBeenCalled();
    });

    it('should save the current input.value, not the captured value', async () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { handleInput } = createDraftSaving();

      // User types 'old', then before the debounce fires (but within the
      // 500 ms), types 'new'. The debounce should persist 'new' — the
      // freshest state — not the captured 'old'.
      handleInput({ target: { value: 'old' } });
      vi.advanceTimersByTime(200);
      handleInput({ target: { value: 'new' } });

      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // Only the last debounce fires (the earlier timer was cleared), and it
      // saves the current input value.
      expect(api.updateSessionPendingPrompt).toHaveBeenCalledTimes(1);
      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'new');
    });
  });

  describe('flush after cancel safety', () => {
    it('flush() after handleInput still saves current input.value (regression guard)', () => {
      api.updateSessionPendingPrompt.mockResolvedValue({});
      const { handleInput, flush } = createDraftSaving();

      handleInput({ target: { value: 'draft-a' } });
      // Without advancing timers, flush — should save the current value
      flush();

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', 'draft-a');
    });
  });
});
