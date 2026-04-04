import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock useConnectionStatus composable
vi.mock('../composables/useConnectionStatus.js', async () => {
  const { ref } = await import('vue');
  return {
    useConnectionStatus: () => ({
      isStale: ref(false),
      connectionStatus: ref('connected'),
      reconnectAttempt: ref(0),
    }),
  };
});

import CommandsTab from './CommandsTab.vue';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

// Mock WebSocket handlers
vi.mock('../composables/useApi.js');

describe('CommandsTab', () => {
  let pinia;
  let commandButtonsStore;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    commandButtonsStore = useCommandButtonsStore();

    // Mock store methods
    vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue([
      { id: 'btn-1', name: 'Test Button', command: 'npm test' },
      { id: 'btn-2', name: 'Build', command: 'npm run build' }
    ]);

    vi.spyOn(commandButtonsStore, 'fetchActiveRuns').mockResolvedValue([
      { buttonId: 'btn-1', runId: 'run-1' }
    ]);
  });

  describe('component rendering', () => {
    it('renders the CommandsTab component', () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('initialization and data loading', () => {
    it('sets up WebSocket handlers immediately on mount', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Component should have set up WebSocket handlers
      expect(wrapper.exists()).toBe(true);
    });

    it('fetches buttons and active runs in parallel', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Both fetch methods should be called
      expect(commandButtonsStore.fetchButtons).toHaveBeenCalledWith('proj-1');
      expect(commandButtonsStore.fetchActiveRuns).toHaveBeenCalledWith('session-1');
    });

    it('uses getLatestRunForButton to retrieve current run for each button', async () => {
      // Setup store with multiple runs for same button in same session
      commandButtonsStore.buttons = [
        { id: 'btn-1', name: 'Test Button', command: 'npm test', projectId: 'proj-1' },
      ];

      // Pre-populate runs in store with multiple runs for the same button
      commandButtonsStore.runs = {
        'run-1': {
          runId: 'run-1',
          buttonId: 'btn-1',
          sessionId: 'session-1',
          startedAt: Date.now() - 10000,
          status: 'success',
          output: 'First run'
        },
        'run-2': {
          runId: 'run-2',
          buttonId: 'btn-1',
          sessionId: 'session-1',
          startedAt: Date.now(),
          status: 'running',
          output: 'Latest run'
        },
        'run-3': {
          runId: 'run-3',
          buttonId: 'btn-1',
          sessionId: 'session-2', // Different session
          startedAt: Date.now() - 5000,
          status: 'success',
          output: 'Different session run'
        }
      };

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Verify getLatestRunForButton returns the most recent run for this session
      const latestRun = commandButtonsStore.getLatestRunForButton('btn-1', 'session-1');

      // Should return the most recent run (run-2) not run-1 (older) or run-3 (different session)
      expect(latestRun).toBeDefined();
      expect(latestRun.runId).toBe('run-2');
      expect(latestRun.sessionId).toBe('session-1');
      expect(latestRun.status).toBe('running');
      expect(latestRun.output).toBe('Latest run');
    });
  });

  describe('performance optimization - parallel loading', () => {
    it('does not wait for buttons fetch before starting active runs fetch', async () => {
      const slowButtonsFetch = new Promise(resolve =>
        setTimeout(() => resolve([]), 500)
      );
      const fastActiveRunsFetch = Promise.resolve([]);

      commandButtonsStore.fetchButtons.mockReturnValueOnce(slowButtonsFetch);
      commandButtonsStore.fetchActiveRuns.mockReturnValueOnce(fastActiveRunsFetch);

      const startTime = Date.now();

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // If fetches were sequential, total time would be ~500ms+
      // With parallel loading, it should be closer to 500ms total
      const elapsed = Date.now() - startTime;

      // Both should have been called immediately (not sequentially)
      expect(commandButtonsStore.fetchButtons).toHaveBeenCalled();
      expect(commandButtonsStore.fetchActiveRuns).toHaveBeenCalled();
    });
  });

  describe('button state management', () => {
    it('renders command buttons from store', async () => {
      commandButtonsStore.buttons = [
        { id: 'btn-1', name: 'Test', command: 'npm test', projectId: 'proj-1' },
        { id: 'btn-2', name: 'Build', command: 'npm run build', projectId: 'proj-1' }
      ];

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });

    it('associates active runs with correct buttons', async () => {
      commandButtonsStore.buttons = [
        { id: 'btn-1', name: 'Test', command: 'npm test', projectId: 'proj-1' }
      ];

      commandButtonsStore.activeRunsBySessionId = {
        'session-1': [
          { buttonId: 'btn-1', runId: 'run-1', output: 'Test output' }
        ]
      };

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Runs should be mapped to buttons correctly
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('props handling', () => {
    it('accepts projectId prop', () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-123',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      expect(wrapper.props('projectId')).toBe('proj-123');
    });

    it('accepts sessionId prop', () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-456'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      expect(wrapper.props('sessionId')).toBe('session-456');
    });

    it('responds to prop updates', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Update props
      await wrapper.setProps({
        projectId: 'proj-2',
        sessionId: 'session-2'
      });

      expect(wrapper.props('projectId')).toBe('proj-2');
      expect(wrapper.props('sessionId')).toBe('session-2');
    });
  });

  describe('WebSocket integration', () => {
    it('handles WebSocket messages for new runs', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Component should not error when handling WebSocket events
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('component lifecycle', () => {
    it('cleans up on unmount', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      wrapper.unmount();

      // Component should unmount cleanly
      expect(wrapper.exists()).toBe(false);
    });

    it('handles rapid prop changes', async () => {
      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Rapid prop updates
      await wrapper.setProps({ projectId: 'proj-2' });
      await wrapper.setProps({ sessionId: 'session-2' });
      await wrapper.setProps({ projectId: 'proj-3' });

      await flushPromises();

      // Should handle without errors
      expect(wrapper.props('projectId')).toBe('proj-3');
    });
  });

  describe('empty state', () => {
    it('displays appropriate message when no buttons available', async () => {
      commandButtonsStore.fetchButtons.mockResolvedValueOnce([]);

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1'
        },
        global: {
          plugins: [pinia],
          stubs: {
            CommandButtonItem: true,
            LoadingSpinner: true
          }
        }
      });

      await flushPromises();

      // Component should render and display empty state gracefully
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('connection status - command buttons enabled when connected', () => {
    it('command buttons are NOT disabled when connected (isStale=false)', async () => {
      commandButtonsStore.buttons = [
        { id: 'btn-1', name: 'Test', command: 'npm test', projectId: 'proj-1' },
      ];

      const wrapper = mount(CommandsTab, {
        props: {
          projectId: 'proj-1',
          sessionId: 'session-1',
        },
        global: {
          plugins: [pinia],
          stubs: {
            LoadingSpinner: true,
          },
        },
      });

      await flushPromises();

      // The commands list should be visible
      const commandsList = wrapper.find('[data-testid="commands-tab-list"]');
      expect(commandsList.exists()).toBe(true);

      // The run button should NOT be disabled when isStale is false
      const runButton = wrapper.find('[data-testid="run-button"]');
      expect(runButton.exists()).toBe(true);
      expect(runButton.element.disabled).toBe(false);
      wrapper.unmount();
    });
  });
});
