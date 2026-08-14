import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const mockSessionsStore = {
  sessions: [],
  updateSessionCommandRun: vi.fn(),
  removeSessionCommandRun: vi.fn(),
};

const mockCommandButtonsStore = {
  runs: {},
  appendOutput: vi.fn(),
  completeRun: vi.fn(),
  errorRun: vi.fn(),
  clearRun: vi.fn(),
};

const mockKanbanStore = {
  handleBoardUpdated: vi.fn(),
  handleCardMoved: vi.fn(),
  handleCardAdded: vi.fn(),
  handleCardRemoved: vi.fn(),
  handleSessionUpdated: vi.fn(),
};

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(() => mockCommandButtonsStore),
}));

vi.mock('../stores/kanban.js', () => ({
  useKanbanStore: vi.fn(() => mockKanbanStore),
}));

import { useProjectRealtimeStoreSync } from './useProjectRealtimeStoreSync.js';

/** Build a fake project subscription that captures the registered handlers. */
function createSubscription() {
  const handlers = {};
  const cleanups = {};
  const register = (name) => (callback) => {
    handlers[name] = callback;
    cleanups[name] = vi.fn();
    return cleanups[name];
  };
  return {
    handlers,
    cleanups,
    onSessionUpdated: register('onSessionUpdated'),
    onCommandRunStarted: register('onCommandRunStarted'),
    onCommandRunOutput: register('onCommandRunOutput'),
    onCommandRunComplete: register('onCommandRunComplete'),
    onCommandRunError: register('onCommandRunError'),
    onCommandRunDeleted: register('onCommandRunDeleted'),
    onKanbanBoardUpdated: register('onKanbanBoardUpdated'),
    onKanbanCardMoved: register('onKanbanCardMoved'),
    onKanbanCardAdded: register('onKanbanCardAdded'),
    onKanbanCardRemoved: register('onKanbanCardRemoved'),
  };
}

describe('useProjectRealtimeStoreSync', () => {
  let subscription;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSessionsStore.sessions = [];
    mockCommandButtonsStore.runs = {};
    subscription = createSubscription();
  });

  describe('command run events', () => {
    it('creates a running entry and marks the session run as running on start', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onCommandRunStarted('run-1', 'session-1', 'button-1');

      expect(mockCommandButtonsStore.runs['run-1']).toMatchObject({
        runId: 'run-1', sessionId: 'session-1', buttonId: 'button-1', status: 'running',
      });
      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1', 'button-1', expect.objectContaining({ status: 'running', runId: 'run-1' })
      );
    });

    it('appends output for the active sessions tab when the card is eligible', () => {
      useProjectRealtimeStoreSync(subscription, {
        activeTab: ref('sessions'),
        eligibleCommandSessionIds: ref(['session-1']),
      });

      subscription.handlers.onCommandRunOutput('run-1', 'session-1', 'button-1', 'chunk');

      expect(mockCommandButtonsStore.appendOutput).toHaveBeenCalledWith('run-1', 'chunk');
    });

    it('suppresses only the heavy output stream for ineligible cards', () => {
      useProjectRealtimeStoreSync(subscription, {
        activeTab: ref('sessions'),
        eligibleCommandSessionIds: ref([]),
      });

      subscription.handlers.onCommandRunOutput('run-1', 'session-1', 'button-1', 'chunk');

      expect(mockCommandButtonsStore.appendOutput).not.toHaveBeenCalled();
      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1', 'button-1', expect.objectContaining({ status: 'running' })
      );
    });

    it('streams output on the commands tab regardless of card eligibility', () => {
      useProjectRealtimeStoreSync(subscription, {
        activeTab: ref('commands'),
        eligibleCommandSessionIds: ref([]),
      });

      subscription.handlers.onCommandRunOutput('run-1', 'session-1', 'button-1', 'chunk');

      expect(mockCommandButtonsStore.appendOutput).toHaveBeenCalledWith('run-1', 'chunk');
    });

    it('completes runs with a success status when the exit code is zero', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onCommandRunComplete({
        runId: 'run-1', sessionId: 'session-1', buttonId: 'button-1', exitCode: 0, output: 'done',
      });

      expect(mockCommandButtonsStore.completeRun).toHaveBeenCalledWith('run-1', 0, 'done');
      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1', 'button-1', expect.objectContaining({ status: 'success', exitCode: 0 })
      );
    });

    it('completes runs with an error status when the exit code is non-zero', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onCommandRunComplete({
        runId: 'run-1', sessionId: 'session-1', buttonId: 'button-1', exitCode: 1, output: 'boom',
      });

      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1', 'button-1', expect.objectContaining({ status: 'error', exitCode: 1 })
      );
    });

    it('records run errors', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onCommandRunError('run-1', 'session-1', 'button-1', 'failed');

      expect(mockCommandButtonsStore.errorRun).toHaveBeenCalledWith('run-1', 'failed');
      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1', 'button-1', expect.objectContaining({ status: 'error' })
      );
    });

    it('clears deleted runs from both stores', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onCommandRunDeleted('run-1', 'session-1', 'button-1');

      expect(mockCommandButtonsStore.clearRun).toHaveBeenCalledWith('run-1');
      expect(mockSessionsStore.removeSessionCommandRun).toHaveBeenCalledWith('session-1', 'button-1');
    });
  });

  describe('kanban events', () => {
    it('applies board and card events to the kanban store', () => {
      useProjectRealtimeStoreSync(subscription);

      subscription.handlers.onKanbanBoardUpdated({ id: 'board-1' });
      subscription.handlers.onKanbanCardMoved('card-1', 'lane-1', 'lane-2', { id: 'card-1' });
      subscription.handlers.onKanbanCardAdded({ id: 'card-2' }, 'lane-1');
      subscription.handlers.onKanbanCardRemoved('card-2', 'lane-1');
      subscription.handlers.onSessionUpdated({ id: 'session-1' });

      expect(mockKanbanStore.handleBoardUpdated).toHaveBeenCalledWith({ id: 'board-1' });
      expect(mockKanbanStore.handleCardMoved).toHaveBeenCalledWith('card-1', 'lane-1', 'lane-2', { id: 'card-1' });
      expect(mockKanbanStore.handleCardAdded).toHaveBeenCalledWith({ id: 'card-2' }, 'lane-1');
      expect(mockKanbanStore.handleCardRemoved).toHaveBeenCalledWith('card-2', 'lane-1');
      expect(mockKanbanStore.handleSessionUpdated).toHaveBeenCalledWith({ id: 'session-1' });
    });
  });

  it('removes every registered handler on cleanup', () => {
    const cleanup = useProjectRealtimeStoreSync(subscription);

    cleanup();

    for (const unregister of Object.values(subscription.cleanups)) {
      expect(unregister).toHaveBeenCalled();
    }
  });

  it('skips handlers the subscription does not provide', () => {
    const partial = { onKanbanBoardUpdated: (cb) => { partial.handler = cb; return vi.fn(); } };

    expect(() => useProjectRealtimeStoreSync(partial)).not.toThrow();
    partial.handler({ id: 'board-1' });
    expect(mockKanbanStore.handleBoardUpdated).toHaveBeenCalledWith({ id: 'board-1' });
  });
});
