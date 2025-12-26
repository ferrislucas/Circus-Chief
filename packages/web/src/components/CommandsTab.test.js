import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CommandsTab from './CommandsTab.vue';

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock stores
vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(),
}));

// Mock API
vi.mock('../composables/useApi.js', () => ({
  api: {
    createCanvasItem: vi.fn().mockResolvedValue({}),
  },
}));

const { useCommandButtonsStore } = await import('../stores/commandButtons.js');
const { useUiStore } = await import('../stores/ui.js');
const { useSessionSubscription } = await import('../composables/useWebSocket.js');

describe('CommandsTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Default WebSocket subscription mock
    vi.mocked(useSessionSubscription).mockReturnValue({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      onCommandOutput: vi.fn((cb) => () => {}),
      onCommandComplete: vi.fn((cb) => () => {}),
      onCommandError: vi.fn((cb) => () => {}),
    });
  });

  it('renders loading state', async () => {
    const mockStore = {
      buttons: [],
      runs: {},
      loading: true,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Loading command buttons');
  });

  it('renders empty state when no buttons', async () => {
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('No command buttons configured');
  });

  it('renders error state', async () => {
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: 'Failed to fetch buttons',
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Failed to fetch buttons');
  });

  it('renders command button items', async () => {
    const mockStore = {
      buttons: [
        { id: '1', label: 'Test', command: 'npm test', sortOrder: 0 },
        { id: '2', label: 'Build', command: 'npm run build', sortOrder: 1 },
      ],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: { template: '<div class="command-button-item">{{ button.label }}</div>' },
          RouterLink: true,
        },
      },
    });

    // Items should be rendered
    const items = wrapper.findAll('.command-button-item');
    expect(items).toHaveLength(2);
  });

  it('fetches buttons on mount', async () => {
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons,
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    expect(fetchButtons).toHaveBeenCalledWith('project-1');
  });

  it('handles button run event', async () => {
    const runButton = vi.fn().mockResolvedValue('run-1');
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
      runButton,
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: {
            template: '<button @click="$emit(\'run\')">Run</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit run event from child
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Verify runButton was called
    expect(runButton).toHaveBeenCalledWith('session-1', 'btn-1');
  });

  it('handles copy output event', async () => {
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: {
            template: '<button @click="$emit(\'copy-output\', \'test output\')">Copy</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit copy event
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Verify success message
    expect(mockUiStore.success).toHaveBeenCalledWith('Output copied to clipboard');
  });

  it('handles send to canvas event', async () => {
    const { api } = await import('../composables/useApi.js');
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test Command', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: {
            template: '<button @click="$emit(\'send-to-canvas\', \'Test Button\', \'output\')">Send</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit send to canvas event
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Verify success message and API call
    expect(mockUiStore.success).toHaveBeenCalledWith('Output sent to canvas');
    expect(vi.mocked(api.createCanvasItem)).toHaveBeenCalledWith('session-1', {
      type: 'text',
      filename: 'test-button-output.txt',
      content: 'output',
      label: 'Test Button output',
    });
  });

  it('subscribes to WebSocket events on mount', async () => {
    const onCommandOutput = vi.fn(() => () => {});
    const onCommandComplete = vi.fn(() => () => {});
    const onCommandError = vi.fn(() => () => {});
    const subscribe = vi.fn();

    vi.mocked(useSessionSubscription).mockReturnValue({
      subscribe,
      unsubscribe: vi.fn(),
      onCommandOutput,
      onCommandComplete,
      onCommandError,
    });

    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      getRun: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    expect(subscribe).toHaveBeenCalled();
    expect(onCommandOutput).toHaveBeenCalled();
    expect(onCommandComplete).toHaveBeenCalled();
    expect(onCommandError).toHaveBeenCalled();
  });
});
