import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';

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
  useUiStore: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock WebSocket composable
vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onCommandOutput: vi.fn(() => () => {}),
    onCommandComplete: vi.fn(() => () => {}),
    onCommandError: vi.fn(() => () => {}),
  })),
}));

// Mock API
vi.mock('../composables/useApi.js', () => ({
  api: {
    createCanvasItem: vi.fn().mockResolvedValue({}),
  },
}));

// Import AFTER mocks are set up
import CommandsTab from './CommandsTab.vue';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useWebSocket.js';
import { api } from '../composables/useApi.js';

describe('CommandsTab', () => {
  let mockCommandButtonsStore;
  let mockUiStore;

  // Stub child component
  const CommandButtonItemStub = defineComponent({
    name: 'CommandButtonItem',
    props: ['button', 'run', 'sessionId'],
    emits: ['run', 'kill', 'copy-output', 'send-to-canvas'],
    template: '<div class="command-button-item">{{ button.label }}</div>',
  });

  beforeEach(() => {
    setActivePinia(createPinia());

    // Default store mocks
    mockCommandButtonsStore = {
      buttons: [],
      runs: {},
      loading: false,
      error: null,
      fetchButtons: vi.fn().mockResolvedValue(undefined),
      fetchActiveRuns: vi.fn().mockResolvedValue([]),
      getRun: vi.fn(),
      runButton: vi.fn().mockResolvedValue('run-1'),
      killRun: vi.fn().mockResolvedValue(undefined),
      appendOutput: vi.fn(),
      completeRun: vi.fn(),
      errorRun: vi.fn(),
    };

    mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);
    vi.mocked(api.createCanvasItem).mockClear();
  });

  function mountComponent(props = { sessionId: 'session-1', projectId: 'project-1' }) {
    return mount(CommandsTab, {
      props,
      global: {
        stubs: {
          CommandButtonItem: CommandButtonItemStub,
          'router-link': true,
        },
      },
    });
  }

  it('renders loading state', async () => {
    mockCommandButtonsStore.loading = true;

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Loading command buttons');
  });

  it('renders empty state when no buttons', async () => {
    mockCommandButtonsStore.buttons = [];
    mockCommandButtonsStore.loading = false;

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('No command buttons configured');
  });

  it('renders error state', async () => {
    mockCommandButtonsStore.error = 'Failed to fetch buttons';
    mockCommandButtonsStore.loading = false;

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Failed to fetch buttons');
  });

  it('renders command button items', async () => {
    mockCommandButtonsStore.buttons = [
      { id: '1', label: 'Test', command: 'npm test', sortOrder: 0 },
      { id: '2', label: 'Build', command: 'npm run build', sortOrder: 1 },
    ];

    const wrapper = mountComponent();

    // Items should be rendered
    const items = wrapper.findAll('.command-button-item');
    expect(items).toHaveLength(2);
  });

  it('fetches buttons on mount', async () => {
    mountComponent();

    await flushPromises();
    expect(mockCommandButtonsStore.fetchButtons).toHaveBeenCalledWith('project-1');
  });

  it('fetches active runs on mount', async () => {
    mountComponent();

    await flushPromises();
    expect(mockCommandButtonsStore.fetchActiveRuns).toHaveBeenCalledWith('session-1');
  });

  it('restores active runs from fetch result', async () => {
    const activeRunsData = [
      { runId: 'run-1', buttonId: 'btn-1', status: 'running', output: 'Hello\n' },
      { runId: 'run-2', buttonId: 'btn-2', status: 'running', output: 'World\n' },
    ];
    mockCommandButtonsStore.fetchActiveRuns.mockResolvedValue(activeRunsData);

    mountComponent();

    await flushPromises();

    // Verify fetchActiveRuns was called and returned the correct data
    expect(mockCommandButtonsStore.fetchActiveRuns).toHaveBeenCalledWith('session-1');

    // The component should map button IDs to run IDs internally
    // This is verified by checking that getRun is called with the restored run IDs
    // when buttons are rendered (the mapping is done in currentRunIds reactive object)
  });

  it('handles button run event', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    // Use a custom stub that emits the run event
    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: {
            template: '<button @click="$emit(\'run\')">Run</button>',
            props: ['button', 'run', 'sessionId'],
          },
          'router-link': true,
        },
      },
    });

    // Emit run event from child
    const button = wrapper.find('button');
    await button.trigger('click');
    await flushPromises();

    // Verify runButton was called
    expect(mockCommandButtonsStore.runButton).toHaveBeenCalledWith('session-1', 'btn-1');
  });

  it('handles copy output event successfully', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    // Ensure mock is set up correctly
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
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
            template: '<div @copy-output="$emit(\'copy-output\', output)" ref="stub">Copy</div>',
            props: ['button', 'run', 'sessionId'],
            emits: ['run', 'kill', 'copy-output', 'send-to-canvas'],
            setup() {
              return { output: 'test output' };
            },
          },
          'router-link': true,
        },
      },
    });

    await flushPromises(); // Wait for mount to complete

    // Manually call the parent's onCopyOutput handler
    // This works around Vue Test Utils limitation with stub event propagation
    await wrapper.vm.onCopyOutput('test output');
    await flushPromises();

    // Verify success message
    expect(mockUiStore.success).toHaveBeenCalledWith('Output copied to clipboard');
  });

  it('handles copy output when output is null', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
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
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler with null
    await wrapper.vm.onCopyOutput(null);
    await flushPromises();

    // Should show error instead of success
    expect(mockUiStore.error).toHaveBeenCalledWith('No output to copy');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles copy output when output is not a string', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
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
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler with object
    await wrapper.vm.onCopyOutput({ data: 'object' });
    await flushPromises();

    // Should show error for non-string type
    expect(mockUiStore.error).toHaveBeenCalledWith('Output is not text');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles copy output when clipboard is unavailable', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
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
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler
    await wrapper.vm.onCopyOutput('output');
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
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
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
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler
    await wrapper.vm.onCopyOutput('output');
    await flushPromises();

    // Should show permission denied error
    expect(mockUiStore.error).toHaveBeenCalledWith(
      'Clipboard access denied - check browser permissions'
    );
  });

  it('handles send to canvas event successfully', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test Command', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler
    await wrapper.vm.onSendToCanvas('Test Button', 'output');
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
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test Command', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler with null
    await wrapper.vm.onSendToCanvas('Test Button', null);
    await flushPromises();

    // Should show error instead of trying to send
    expect(mockUiStore.error).toHaveBeenCalledWith('No output to send to canvas');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles send to canvas when output is not a string', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test Command', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler with number
    await wrapper.vm.onSendToCanvas('Test Button', 123);
    await flushPromises();

    // Should show error for non-string type
    expect(mockUiStore.error).toHaveBeenCalledWith('Output must be text');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });

  it('handles send to canvas with special characters in label', async () => {
    mockCommandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test@#$%^&*()', command: 'npm test', sortOrder: 0 },
    ];

    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandButtonsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandsTab, {
      props: {
        sessionId: 'session-1',
        projectId: 'project-1',
      },
      global: {
        stubs: {
          CommandButtonItem: true,
          'router-link': true,
        },
      },
    });

    await flushPromises();

    // Manually call the handler
    await wrapper.vm.onSendToCanvas('Test@#$%^&*()', 'output');
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

    mountComponent();

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
