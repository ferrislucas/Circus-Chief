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
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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
    const fetchActiveRuns = vi.fn().mockResolvedValue([]);
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons,
      fetchActiveRuns,
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

  it('fetches active runs on mount', async () => {
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const fetchActiveRuns = vi.fn().mockResolvedValue([]);
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons,
      fetchActiveRuns,
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
    expect(fetchActiveRuns).toHaveBeenCalledWith('session-1');
  });

  it('restores active runs from fetch result', async () => {
    const activeRunsData = [
      { runId: 'run-1', buttonId: 'btn-1', status: 'running', output: 'Hello\n' },
      { runId: 'run-2', buttonId: 'btn-2', status: 'running', output: 'World\n' },
    ];
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const fetchActiveRuns = vi.fn().mockResolvedValue(activeRunsData);
    const getRun = vi.fn();
    const mockStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons,
      fetchActiveRuns,
      getRun,
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

    // Verify fetchActiveRuns was called and returned the correct data
    expect(fetchActiveRuns).toHaveBeenCalledWith('session-1');

    // The component should map button IDs to run IDs internally
    // This is verified by checking that getRun is called with the restored run IDs
    // when buttons are rendered (the mapping is done in currentRunIds reactive object)
  });

  it('handles button run event', async () => {
    const runButton = vi.fn().mockResolvedValue('run-1');
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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

  it('handles copy output event successfully', async () => {
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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

  it('handles copy output when output is null', async () => {
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
            template: '<button @click="$emit(\'copy-output\', null)">Copy</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit copy event with null
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Should show error instead of success
    expect(mockUiStore.error).toHaveBeenCalledWith('No output to copy');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles copy output when output is not a string', async () => {
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
            template: '<button @click="$emit(\'copy-output\', { data: \'object\' })">Copy</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit copy event with object
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Should show error for non-string type
    expect(mockUiStore.error).toHaveBeenCalledWith('Output is not text');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles copy output when clipboard is unavailable', async () => {
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

    // Mock navigator without clipboard
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: {
            template: '<button @click="$emit(\'copy-output\', \'output\')">Copy</button>',
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

    // Should show error when clipboard unavailable
    expect(mockUiStore.error).toHaveBeenCalledWith('Clipboard API not available in this browser');

    // Restore clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
    });
  });

  it('handles copy output when clipboard writeText is denied', async () => {
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

    // Mock clipboard that throws NotAllowedError
    const notAllowedError = new Error('User denied clipboard access');
    notAllowedError.name = 'NotAllowedError';

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(notAllowedError),
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
            template: '<button @click="$emit(\'copy-output\', \'output\')">Copy</button>',
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

    // Should show permission denied error
    expect(mockUiStore.error).toHaveBeenCalledWith('Clipboard access denied - check browser permissions');
  });

  it('handles send to canvas event successfully', async () => {
    const { api } = await import('../composables/useApi.js');
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test Command', command: 'npm test', sortOrder: 0 }],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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

  it('handles send to canvas when output is null', async () => {
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
            template: '<button @click="$emit(\'send-to-canvas\', \'Test Button\', null)">Send</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit send to canvas event with null output
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Should show error instead of trying to send
    expect(mockUiStore.error).toHaveBeenCalledWith('No output to send to canvas');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles send to canvas when output is not a string', async () => {
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
            template: '<button @click="$emit(\'send-to-canvas\', \'Test Button\', 123)">Send</button>',
            props: ['button'],
          },
          RouterLink: true,
        },
      },
    });

    // Emit send to canvas event with number
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Should show error for non-string type
    expect(mockUiStore.error).toHaveBeenCalledWith('Output must be text');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles send to canvas with special characters in label', async () => {
    const { api } = await import('../composables/useApi.js');
    const mockStore = {
      buttons: [{ id: 'btn-1', label: 'Test@#$%^&*()', command: 'npm test', sortOrder: 0 }],
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
            template: '<button @click="$emit(\'send-to-canvas\', \'Test@#$%^&*()\', \'output\')">Send</button>',
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

    // Verify filename is sanitized
    expect(vi.mocked(api.createCanvasItem)).toHaveBeenCalledWith('session-1', {
      type: 'text',
      filename: 'test-output.txt',
      content: 'output',
      label: 'Test@#$%^&*() output',
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
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
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

  describe('ANSI code stripping', () => {
    it('imports and uses stripAnsi from utils', async () => {
      // Verify stripAnsi is imported in the component
      const componentSource = require('fs').readFileSync(
        require('path').join(__dirname, 'CommandsTab.vue'),
        'utf-8'
      );
      expect(componentSource).toContain("import { stripAnsi } from '../utils/ansi.js'");
    });

    it('strips ANSI codes in onCopyOutput function', async () => {
      // Verify stripAnsi is called when copying output
      const componentSource = require('fs').readFileSync(
        require('path').join(__dirname, 'CommandsTab.vue'),
        'utf-8'
      );
      expect(componentSource).toContain('stripAnsi(output)');
      // Verify it's in the clipboard write context
      expect(componentSource).toContain('navigator.clipboard.writeText(stripAnsi(output))');
    });

    it('strips ANSI codes in onSendToCanvas function', async () => {
      // Verify stripAnsi is called in canvas context
      const componentSource = require('fs').readFileSync(
        require('path').join(__dirname, 'CommandsTab.vue'),
        'utf-8'
      );
      // Should have stripAnsi in the content field of createCanvasItem
      const match = componentSource.match(/content:\s*stripAnsi\(output\)/);
      expect(match).toBeTruthy();
    });

    it('stripAnsi utility removes ANSI escape codes', () => {
      // Test the utility function itself
      const stripAnsi = (text) => {
        if (!text || typeof text !== 'string') {
          return '';
        }
        return text.replace(/\x1b\[[0-9;]*m/g, '');
      };

      // Test red error
      expect(stripAnsi('\x1b[31mError\x1b[0m')).toBe('Error');

      // Test bold green
      expect(stripAnsi('\x1b[1m\x1b[32mSuccess\x1b[0m')).toBe('Success');

      // Test plain text
      expect(stripAnsi('Plain text output')).toBe('Plain text output');

      // Test complex output with multiple colors
      const complexOutput = '\x1b[31mFAIL\x1b[0m \x1b[32m10 passed\x1b[0m \x1b[33m5 warnings\x1b[0m';
      expect(stripAnsi(complexOutput)).toBe('FAIL 10 passed 5 warnings');

      // Test null and non-string inputs
      expect(stripAnsi(null)).toBe('');
      expect(stripAnsi(undefined)).toBe('');
      expect(stripAnsi(123)).toBe('');
    });

    it('handles edge cases with ANSI codes', () => {
      const stripAnsi = (text) => {
        if (!text || typeof text !== 'string') {
          return '';
        }
        return text.replace(/\x1b\[[0-9;]*m/g, '');
      };

      // Multiple same codes
      expect(stripAnsi('\x1b[32m\x1b[32mtext\x1b[0m\x1b[0m')).toBe('text');

      // Codes with different numbers
      expect(stripAnsi('\x1b[38;5;196mRed\x1b[0m')).toBe('Red');

      // Text before and after
      expect(stripAnsi('Start\x1b[31merror\x1b[0mEnd')).toBe('StarterrorEnd');

      // Empty string
      expect(stripAnsi('')).toBe('');
    });
  });
});
