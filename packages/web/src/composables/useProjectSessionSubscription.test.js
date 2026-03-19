import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock stores
const mockProjectsStore = {
  fetchProject: vi.fn(),
};

const mockSessionsStore = {
  fetchSessions: vi.fn(() => Promise.resolve()),
  sessions: [],
  addSessionToList: vi.fn(),
  updateSession: vi.fn(),
  removeSessionFromList: vi.fn(),
  updateSessionCommandRun: vi.fn(),
  removeSessionCommandRun: vi.fn(),
};

const mockCommandButtonsStore = {
  fetchButtons: vi.fn(() => Promise.resolve()),
  runs: {},
  appendOutput: vi.fn(),
  completeRun: vi.fn(),
  errorRun: vi.fn(),
  clearRun: vi.fn(),
};

// Mock useProjectSubscription
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockOnSessionCreated = vi.fn();
const mockOnSessionUpdated = vi.fn();
const mockOnSessionDeleted = vi.fn();
const mockOnSessionSummaryUpdated = vi.fn();
const mockOnCommandRunOutput = vi.fn();
const mockOnCommandRunComplete = vi.fn();
const mockOnCommandRunError = vi.fn();
const mockOnCommandRunDeleted = vi.fn();

vi.mock('../stores/projects.js', () => ({
  useProjectsStore: vi.fn(() => mockProjectsStore),
}));

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => mockSessionsStore),
}));

vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(() => mockCommandButtonsStore),
}));

vi.mock('./useWebSocket.js', () => ({
  useProjectSubscription: vi.fn(() => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    onSessionCreated: mockOnSessionCreated,
    onSessionUpdated: mockOnSessionUpdated,
    onSessionDeleted: mockOnSessionDeleted,
    onSessionSummaryUpdated: mockOnSessionSummaryUpdated,
    onCommandRunOutput: mockOnCommandRunOutput,
    onCommandRunComplete: mockOnCommandRunComplete,
    onCommandRunError: mockOnCommandRunError,
    onCommandRunDeleted: mockOnCommandRunDeleted,
  })),
}));

import { useProjectSessionSubscription } from './useProjectSessionSubscription.js';
import { useProjectsStore } from '../stores/projects.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useProjectSubscription } from './useWebSocket.js';

describe('useProjectSessionSubscription', () => {
  let testComponent;
  let summaryCallbacks;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Reset store state
    mockSessionsStore.sessions = [];
    mockCommandButtonsStore.runs = {};

    // Reset mock functions
    mockProjectsStore.fetchProject.mockReset();
    mockSessionsStore.fetchSessions.mockResolvedValue();
    mockSessionsStore.addSessionToList.mockReset();
    mockSessionsStore.updateSession.mockReset();
    mockSessionsStore.removeSessionFromList.mockReset();
    mockSessionsStore.updateSessionCommandRun.mockReset();
    mockSessionsStore.removeSessionCommandRun.mockReset();
    mockSessionsStore.removeSessionCommandRun.mockReset();
    mockCommandButtonsStore.fetchButtons.mockResolvedValue();
    mockCommandButtonsStore.appendOutput.mockReset();
    mockCommandButtonsStore.completeRun.mockReset();
    mockCommandButtonsStore.errorRun.mockReset();
    mockCommandButtonsStore.clearRun.mockReset();
    mockCommandButtonsStore.clearRun.mockReset();

    mockSubscribe.mockReset();
    mockUnsubscribe.mockReset();
    mockOnSessionCreated.mockReset();
    mockOnSessionUpdated.mockReset();
    mockOnSessionDeleted.mockReset();
    mockOnSessionSummaryUpdated.mockReset();
    mockOnCommandRunOutput.mockReset();
    mockOnCommandRunComplete.mockReset();
    mockOnCommandRunError.mockReset();
    mockOnCommandRunDeleted.mockReset();
    mockOnCommandRunDeleted.mockReset();

    // Setup summary callbacks
    summaryCallbacks = {
      fetchSummariesBatch: vi.fn(),
      updateSummary: vi.fn(),
      cleanupSummary: vi.fn(),
    };

    // Create test component to use the composable
    testComponent = {
      template: '<div>Test</div>',
      setup() {
        const projectId = ref('test-project-1');
        useProjectSessionSubscription(projectId, summaryCallbacks);
        return {};
      },
    };
  });

  describe('initialization', () => {
    it('fetches project data on mount', async () => {
      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockProjectsStore.fetchProject).toHaveBeenCalledWith('test-project-1');
      expect(mockSessionsStore.fetchSessions).toHaveBeenCalledWith('test-project-1');
      expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('test-project-1');
    });

    it('subscribes to WebSocket on mount', async () => {
      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(useProjectSubscription).toHaveBeenCalledWith('test-project-1');
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('calls fetchSummariesBatch with sessions', async () => {
      mockSessionsStore.sessions = [
        { id: 'session-1' },
        { id: 'session-2' },
      ];

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(summaryCallbacks.fetchSummariesBatch).toHaveBeenCalledWith(mockSessionsStore.sessions);
    });
  });

  describe('WebSocket event handlers', () => {
    it('registers session created handler', async () => {
      const cleanup = vi.fn();
      mockOnSessionCreated.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnSessionCreated).toHaveBeenCalled();
      const handler = mockOnSessionCreated.mock.calls[0][0];

      // Simulate session created event
      const newSession = { id: 'new-session', name: 'New Session' };
      handler(newSession);

      expect(mockSessionsStore.addSessionToList).toHaveBeenCalledWith(newSession);
    });

    it('registers session updated handler', async () => {
      const cleanup = vi.fn();
      mockOnSessionUpdated.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnSessionUpdated).toHaveBeenCalled();
      const handler = mockOnSessionUpdated.mock.calls[0][0];

      // Simulate session updated event
      const updatedSession = { id: 'session-1', name: 'Updated Session' };
      handler(updatedSession);

      expect(mockSessionsStore.updateSession).toHaveBeenCalledWith(updatedSession);
    });

    it('registers session deleted handler', async () => {
      const cleanup = vi.fn();
      mockOnSessionDeleted.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnSessionDeleted).toHaveBeenCalled();
      const handler = mockOnSessionDeleted.mock.calls[0][0];

      // Simulate session deleted event
      handler('deleted-session-id');

      expect(mockSessionsStore.removeSessionFromList).toHaveBeenCalledWith('deleted-session-id');
      expect(summaryCallbacks.cleanupSummary).toHaveBeenCalledWith('deleted-session-id');
    });

    it('registers session summary updated handler', async () => {
      const cleanup = vi.fn();
      mockOnSessionSummaryUpdated.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnSessionSummaryUpdated).toHaveBeenCalled();
      const handler = mockOnSessionSummaryUpdated.mock.calls[0][0];

      // Simulate summary updated event
      handler('session-1', 'Test summary content');

      expect(summaryCallbacks.updateSummary).toHaveBeenCalledWith('session-1', 'Test summary content');
    });
  });

  describe('command run event handlers', () => {
    it('registers command run output handler', async () => {
      const cleanup = vi.fn();
      mockOnCommandRunOutput.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnCommandRunOutput).toHaveBeenCalled();
      const handler = mockOnCommandRunOutput.mock.calls[0][0];

      // Simulate command run output event
      handler('run-1', 'session-1', 'button-1', 'output line 1\n');

      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1',
        'button-1',
        expect.objectContaining({
          buttonId: 'button-1',
          status: 'running',
          runId: 'run-1',
        })
      );
    });

    it('registers command run complete handler', async () => {
      const cleanup = vi.fn();
      mockOnCommandRunComplete.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnCommandRunComplete).toHaveBeenCalled();
      const handler = mockOnCommandRunComplete.mock.calls[0][0];

      // Simulate command run complete event
      handler({ runId: 'run-1', sessionId: 'session-1', buttonId: 'button-1', exitCode: 0, output: 'all output' });

      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1',
        'button-1',
        expect.objectContaining({
          buttonId: 'button-1',
          status: 'success',
          exitCode: 0,
          runId: 'run-1',
        })
      );
    });

    it('registers command run error handler', async () => {
      const cleanup = vi.fn();
      mockOnCommandRunError.mockReturnValue(cleanup);

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockOnCommandRunError).toHaveBeenCalled();
      const handler = mockOnCommandRunError.mock.calls[0][0];

      // Simulate command run error event
      handler('run-1', 'session-1', 'button-1', new Error('Command failed'));

      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalledWith(
        'session-1',
        'button-1',
        expect.objectContaining({
          buttonId: 'button-1',
          status: 'error',
          runId: 'run-1',
        })
      );
    });
  });

  describe('cleanup', () => {
    it('registers all WebSocket event handlers', async () => {
      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify all handlers are registered
      expect(mockOnSessionCreated).toHaveBeenCalled();
      expect(mockOnSessionUpdated).toHaveBeenCalled();
      expect(mockOnSessionDeleted).toHaveBeenCalled();
      expect(mockOnSessionSummaryUpdated).toHaveBeenCalled();
      expect(mockOnCommandRunOutput).toHaveBeenCalled();
      expect(mockOnCommandRunComplete).toHaveBeenCalled();
      expect(mockOnCommandRunError).toHaveBeenCalled();
    });

    it('subscribes to WebSocket', async () => {
      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  describe('archivedLoaded state', () => {
    it('returns archivedLoaded ref', async () => {
      let archivedLoaded;

      const componentWithReturn = {
        template: '<div>Test</div>',
        setup() {
          const projectId = ref('test-project-1');
          const result = useProjectSessionSubscription(projectId, summaryCallbacks);
          archivedLoaded = result.archivedLoaded;
          return {};
        },
      };

      mount(componentWithReturn, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(archivedLoaded).toBeDefined();
      expect(archivedLoaded.value).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('does not initialize when projectId is null', async () => {
      const componentWithNullProject = {
        template: '<div>Test</div>',
        setup() {
          const projectId = ref(null);
          useProjectSessionSubscription(projectId, summaryCallbacks);
          return {};
        },
      };

      mount(componentWithNullProject, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockProjectsStore.fetchProject).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('handles missing session command run gracefully', async () => {
      const cleanup = vi.fn();
      mockOnCommandRunOutput.mockReturnValue(cleanup);
      mockSessionsStore.sessions = [];

      mount(testComponent, {
        global: {
          plugins: [createPinia()],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      const handler = mockOnCommandRunOutput.mock.calls[0][0];

      // Simulate command run output for a session that doesn't exist in the list
      handler('run-1', 'non-existent-session', 'button-1', 'output');

      // Should not throw, just handle gracefully
      expect(mockSessionsStore.updateSessionCommandRun).toHaveBeenCalled();
    });
  });
});
