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
});
