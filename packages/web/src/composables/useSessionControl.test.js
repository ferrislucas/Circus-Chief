import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionControl } from './useSessionControl.js';

// Mock stores
const mockSessionsStore = {
  stopSession: vi.fn(),
  restartSession: vi.fn(),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  updateSessionThinking: vi.fn(),
  markRecentSend: vi.fn(),
};

const mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: () => mockSessionsStore,
}));

vi.mock('./useOverlayStore.js', () => ({
  useInjectedSessionsStore: () => mockSessionsStore,
  useInjectedTodosStore: () => ({}),
  SESSIONS_STORE_KEY: Symbol('test-sessions-store'),
  TODOS_STORE_KEY: Symbol('test-todos-store'),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

// Mock the API module
vi.mock('./useApi.js', () => ({
  api: {
    updateSessionPendingPrompt: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from './useApi.js';

describe('useSessionControl', () => {
  let getSessionId;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionId = () => 'session-123';
  });

  function createControl(overrides = {}) {
    return useSessionControl({
      getSessionId,
      ...overrides,
    });
  }

  describe('initial state', () => {
    it('should initialize all loading states to false', () => {
      const { sending, stopping, restarting, togglingThinking } = createControl();

      expect(sending.value).toBe(false);
      expect(stopping.value).toBe(false);
      expect(restarting.value).toBe(false);
      expect(togglingThinking.value).toBe(false);
    });
  });

  describe('handleStop', () => {
    it('should call stopSession with correct ID', async () => {
      mockSessionsStore.stopSession.mockResolvedValue();
      const { handleStop } = createControl();

      await handleStop();

      expect(mockSessionsStore.stopSession).toHaveBeenCalledWith('session-123');
    });

    it('should show success toast on success', async () => {
      mockSessionsStore.stopSession.mockResolvedValue();
      const { handleStop } = createControl();

      await handleStop();

      expect(mockUiStore.success).toHaveBeenCalledWith('Session stopped');
    });

    it('should show error toast on failure', async () => {
      mockSessionsStore.stopSession.mockRejectedValue(new Error('Stop failed'));
      const { handleStop } = createControl();

      await handleStop();

      expect(mockUiStore.error).toHaveBeenCalledWith('Stop failed');
    });

    it('should set stopping to true during operation', async () => {
      let resolvePromise;
      mockSessionsStore.stopSession.mockImplementation(() =>
        new Promise(resolve => { resolvePromise = resolve; })
      );

      const { handleStop, stopping } = createControl();
      const promise = handleStop();

      expect(stopping.value).toBe(true);

      resolvePromise();
      await promise;

      expect(stopping.value).toBe(false);
    });

    it('should prevent concurrent stop calls', async () => {
      let resolvePromise;
      mockSessionsStore.stopSession.mockImplementation(() =>
        new Promise(resolve => { resolvePromise = resolve; })
      );

      const { handleStop, stopping } = createControl();
      stopping.value = true;

      await handleStop();

      expect(mockSessionsStore.stopSession).not.toHaveBeenCalled();
    });
  });

  describe('handleRestart', () => {
    it('should call restartSession with correct ID', async () => {
      mockSessionsStore.restartSession.mockResolvedValue();
      const { handleRestart } = createControl();

      await handleRestart();

      expect(mockSessionsStore.restartSession).toHaveBeenCalledWith('session-123');
    });

    it('should show success toast on success', async () => {
      mockSessionsStore.restartSession.mockResolvedValue();
      const { handleRestart } = createControl();

      await handleRestart();

      expect(mockUiStore.success).toHaveBeenCalledWith('Session restarted');
    });

    it('should show error toast on failure', async () => {
      mockSessionsStore.restartSession.mockRejectedValue(new Error('Restart failed'));
      const { handleRestart } = createControl();

      await handleRestart();

      expect(mockUiStore.error).toHaveBeenCalledWith('Restart failed');
    });

    it('should set restarting to false after operation', async () => {
      mockSessionsStore.restartSession.mockResolvedValue();
      const { handleRestart, restarting } = createControl();

      await handleRestart();

      expect(restarting.value).toBe(false);
    });
  });

  describe('handleStart', () => {
    it('should call startSession with correct parameters', async () => {
      mockSessionsStore.startSession.mockResolvedValue();
      const { handleStart } = createControl();

      await handleStart('Hello Claude', 'sonnet');

      expect(mockSessionsStore.startSession).toHaveBeenCalledWith('session-123', 'Hello Claude', 'sonnet');
    });

    it('should not start with empty prompt', async () => {
      const { handleStart } = createControl();

      await handleStart('', 'sonnet');

      expect(mockSessionsStore.startSession).not.toHaveBeenCalled();
    });

    it('should not start with whitespace-only prompt', async () => {
      const { handleStart } = createControl();

      await handleStart('   ', 'sonnet');

      expect(mockSessionsStore.startSession).not.toHaveBeenCalled();
    });

    it('should not start with null prompt', async () => {
      const { handleStart } = createControl();

      await handleStart(null, 'sonnet');

      expect(mockSessionsStore.startSession).not.toHaveBeenCalled();
    });

    it('should show error toast on failure', async () => {
      mockSessionsStore.startSession.mockRejectedValue(new Error('Start failed'));
      const { handleStart } = createControl();

      await handleStart('test prompt', 'sonnet');

      expect(mockUiStore.error).toHaveBeenCalledWith('Start failed');
    });

    it('should return true on successful start', async () => {
      mockSessionsStore.startSession.mockResolvedValue();
      const { handleStart } = createControl();

      const result = await handleStart('test prompt', 'sonnet');

      expect(result).toBe(true);
    });

    it('should return false on start failure', async () => {
      mockSessionsStore.startSession.mockRejectedValue(new Error('Start failed'));
      const { handleStart } = createControl();

      const result = await handleStart('test prompt', 'sonnet');

      expect(result).toBe(false);
    });

    it('should return false when prompt is empty', async () => {
      const { handleStart } = createControl();

      const result = await handleStart('', 'sonnet');

      expect(result).toBe(false);
    });

    it('should return false when restarting is already true', async () => {
      const { handleStart, restarting } = createControl();
      restarting.value = true;

      const result = await handleStart('test prompt', 'sonnet');

      expect(result).toBe(false);
    });

    it('should set restarting to false after completion', async () => {
      mockSessionsStore.startSession.mockResolvedValue();
      const { handleStart, restarting } = createControl();

      await handleStart('test', 'sonnet');

      expect(restarting.value).toBe(false);
    });

    it('should call markRecentSend on successful start', async () => {
      mockSessionsStore.startSession.mockResolvedValue();
      const { handleStart } = createControl();

      await handleStart('hello', 'sonnet');

      expect(mockSessionsStore.markRecentSend).toHaveBeenCalledWith('session-123');
    });

    it('should NOT call markRecentSend when startSession fails', async () => {
      mockSessionsStore.startSession.mockRejectedValue(new Error('start failed'));
      const { handleStart } = createControl();

      await handleStart('hello', 'sonnet');

      expect(mockSessionsStore.markRecentSend).not.toHaveBeenCalled();
    });
  });

  describe('handleSend', () => {
    it('should call sendMessage with correct parameters', async () => {
      mockSessionsStore.sendMessage.mockResolvedValue();
      const { handleSend } = createControl();

      await handleSend('Hello', [{ name: 'file.txt' }], 'sonnet');

      expect(mockSessionsStore.sendMessage).toHaveBeenCalledWith(
        'session-123', 'Hello', [{ name: 'file.txt' }], 'sonnet'
      );
    });

    it('should return true on successful send', async () => {
      mockSessionsStore.sendMessage.mockResolvedValue();
      const { handleSend } = createControl();

      const result = await handleSend('Hello', [], 'sonnet');

      expect(result).toBe(true);
    });

    it('should return false on send failure', async () => {
      mockSessionsStore.sendMessage.mockRejectedValue(new Error('Send failed'));
      const { handleSend } = createControl();

      const result = await handleSend('Hello', [], 'sonnet');

      expect(result).toBe(false);
    });

    it('should clear pending prompt on server after successful send', async () => {
      mockSessionsStore.sendMessage.mockResolvedValue();
      const { handleSend } = createControl();

      await handleSend('Hello', [], 'sonnet');

      expect(api.updateSessionPendingPrompt).toHaveBeenCalledWith('session-123', null);
    });

    it('should not send with empty message', async () => {
      const { handleSend } = createControl();

      const result = await handleSend('', [], 'sonnet');

      expect(result).toBe(false);
      expect(mockSessionsStore.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send with whitespace-only message', async () => {
      const { handleSend } = createControl();

      const result = await handleSend('   ', [], 'sonnet');

      expect(result).toBe(false);
    });

    it('should set sending to false after completion', async () => {
      mockSessionsStore.sendMessage.mockResolvedValue();
      const { handleSend, sending } = createControl();

      await handleSend('test', [], 'sonnet');

      expect(sending.value).toBe(false);
    });

    it('should show error toast on failure', async () => {
      mockSessionsStore.sendMessage.mockRejectedValue(new Error('Network error'));
      const { handleSend } = createControl();

      await handleSend('test', [], 'sonnet');

      expect(mockUiStore.error).toHaveBeenCalledWith('Network error');
    });

    describe('ghost-prompt ordering and recovery', () => {
      it('should clear pendingPrompt BEFORE calling sendMessage', async () => {
        const callOrder = [];
        api.updateSessionPendingPrompt.mockImplementation(async (_id, val) => {
          callOrder.push(val === null ? 'clear-pendingPrompt' : `set-pendingPrompt:${val}`);
        });
        mockSessionsStore.sendMessage.mockImplementation(async () => {
          callOrder.push('sendMessage');
        });

        const { handleSend } = createControl();
        await handleSend('hello', [], 'sonnet');

        expect(callOrder[0]).toBe('clear-pendingPrompt');
        expect(callOrder[1]).toBe('sendMessage');
      });

      it('should call markRecentSend on successful send', async () => {
        mockSessionsStore.sendMessage.mockResolvedValue();
        const { handleSend } = createControl();

        await handleSend('hello', [], 'sonnet');

        expect(mockSessionsStore.markRecentSend).toHaveBeenCalledWith('session-123');
      });

      it('should call markRecentSend AFTER sendMessage resolves', async () => {
        const callOrder = [];
        mockSessionsStore.sendMessage.mockImplementation(async () => {
          callOrder.push('sendMessage');
        });
        mockSessionsStore.markRecentSend.mockImplementation(() => {
          callOrder.push('markRecentSend');
        });

        const { handleSend } = createControl();
        await handleSend('hello', [], 'sonnet');

        expect(callOrder).toEqual(['sendMessage', 'markRecentSend']);
      });

      it('should NOT call markRecentSend when sendMessage fails', async () => {
        mockSessionsStore.sendMessage.mockRejectedValue(new Error('boom'));
        const { handleSend } = createControl();

        await handleSend('hello', [], 'sonnet');

        expect(mockSessionsStore.markRecentSend).not.toHaveBeenCalled();
      });

      it('should restore pendingPrompt on server when sendMessage fails', async () => {
        mockSessionsStore.sendMessage.mockRejectedValue(new Error('network down'));
        const { handleSend } = createControl();

        await handleSend('draft text', [], 'sonnet');

        // First call: clear (null). Second call: restore the original message.
        expect(api.updateSessionPendingPrompt).toHaveBeenNthCalledWith(1, 'session-123', null);
        expect(api.updateSessionPendingPrompt).toHaveBeenNthCalledWith(2, 'session-123', 'draft text');
      });

      it('should return false when sendMessage fails', async () => {
        mockSessionsStore.sendMessage.mockRejectedValue(new Error('boom'));
        const { handleSend } = createControl();

        const result = await handleSend('hello', [], 'sonnet');

        expect(result).toBe(false);
      });

      it('should NOT call sendMessage when clear-pendingPrompt throws', async () => {
        api.updateSessionPendingPrompt.mockRejectedValue(new Error('clear failed'));
        const { handleSend } = createControl();

        const result = await handleSend('hello', [], 'sonnet');

        expect(mockSessionsStore.sendMessage).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });

      it('should NOT attempt restore when clear-pendingPrompt itself fails', async () => {
        api.updateSessionPendingPrompt.mockRejectedValue(new Error('clear failed'));
        const { handleSend } = createControl();

        await handleSend('hello', [], 'sonnet');

        // Only one call: the initial clear attempt that failed. No restore.
        expect(api.updateSessionPendingPrompt).toHaveBeenCalledTimes(1);
      });

      it('should swallow restore failures and still surface the primary error', async () => {
        // First call (clear) succeeds. Second call (restore) throws.
        api.updateSessionPendingPrompt
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('restore failed'));
        mockSessionsStore.sendMessage.mockRejectedValue(new Error('send failed'));

        const { handleSend } = createControl();
        const result = await handleSend('hello', [], 'sonnet');

        expect(result).toBe(false);
        // Primary error surfaced to the user, not the restore failure.
        expect(mockUiStore.error).toHaveBeenCalledWith('send failed');
      });
    });
  });

  describe('handleThinkingToggle', () => {
    it('should call updateSessionThinking with new value', async () => {
      mockSessionsStore.updateSessionThinking.mockResolvedValue();
      const { handleThinkingToggle } = createControl();

      await handleThinkingToggle({ target: { checked: true } });

      expect(mockSessionsStore.updateSessionThinking).toHaveBeenCalledWith('session-123', true);
    });

    it('should revert checkbox on error', async () => {
      mockSessionsStore.updateSessionThinking.mockRejectedValue(new Error('Toggle failed'));
      const { handleThinkingToggle } = createControl();
      const event = { target: { checked: true } };

      await handleThinkingToggle(event);

      expect(event.target.checked).toBe(false);
      expect(mockUiStore.error).toHaveBeenCalledWith('Toggle failed');
    });

    it('should set togglingThinking to false after completion', async () => {
      mockSessionsStore.updateSessionThinking.mockResolvedValue();
      const { handleThinkingToggle, togglingThinking } = createControl();

      await handleThinkingToggle({ target: { checked: false } });

      expect(togglingThinking.value).toBe(false);
    });

    it('should prevent concurrent toggle calls', async () => {
      const { handleThinkingToggle, togglingThinking } = createControl();
      togglingThinking.value = true;

      await handleThinkingToggle({ target: { checked: true } });

      expect(mockSessionsStore.updateSessionThinking).not.toHaveBeenCalled();
    });
  });
});
