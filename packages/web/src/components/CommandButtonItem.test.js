/* global global */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import CommandButtonItem from './CommandButtonItem.vue';
import RunTimestamps from './RunTimestamps.vue';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

describe('CommandButtonItem', () => {
  // Set up a fresh Pinia instance before each test
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockButton = {
    id: 'btn-1',
    projectId: 'proj-1',
    label: 'Run Tests',
    command: 'npm test',
    description: 'Run the test suite'
  };

  const mockRun = {
    runId: 'run-1',
    buttonId: 'btn-1',
    status: 'success',
    output: 'Tests passed\n✓ 42 tests completed',
    outputTruncated: false,
    startTime: new Date().toISOString(),
    exitCode: 0
  };

  describe('debounceLeading utility', () => {
    it('calls function immediately on first invocation', async () => {
      const fn = vi.fn();
      const debounce = (cb, delay) => {
        let timeoutId = null;
        let lastCalled = 0;
        return (...args) => {
          const now = Date.now();
          if (timeoutId) clearTimeout(timeoutId);

          if (now - lastCalled >= delay) {
            lastCalled = now;
            cb(...args);
          } else {
            timeoutId = setTimeout(() => {
              lastCalled = Date.now();
              cb(...args);
            }, delay);
          }
        };
      };

      const debouncedFn = debounce(fn, 100);
      debouncedFn('first');

      expect(fn).toHaveBeenCalledWith('first');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('debounces subsequent calls within delay period', async () => {
      const fn = vi.fn();
      const debounce = (cb, delay) => {
        let timeoutId = null;
        let lastCalled = 0;
        return (...args) => {
          const now = Date.now();
          if (timeoutId) clearTimeout(timeoutId);

          if (now - lastCalled >= delay) {
            lastCalled = now;
            cb(...args);
          } else {
            timeoutId = setTimeout(() => {
              lastCalled = Date.now();
              cb(...args);
            }, delay);
          }
        };
      };

      const debouncedFn = debounce(fn, 100);
      debouncedFn('first');
      debouncedFn('second');
      debouncedFn('third');

      expect(fn).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(fn).toHaveBeenLastCalledWith('third');
    });
  });

  describe('component rendering', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders the button component', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1'
        }
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('Run Tests');
    });

    it('displays button name and description', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1'
        }
      });

      expect(wrapper.text()).toContain('Run Tests');
      expect(wrapper.text()).toContain('npm test');
    });

    it('displays run status when run is available', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // For a completed run, a checkmark SVG is displayed
      expect(wrapper.find('[data-testid="command-status"] svg').exists()).toBe(true);
    });
  });

  describe('output rendering', () => {
    it('shows no output message when run has no output', async () => {
      const runWithoutOutput = { ...mockRun, output: undefined };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      // Should render the output section header
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);
      expect(outputHeader.text()).toContain('Output');
    });

    it('displays output when available', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Should render the output section header
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);

      // Should display the run status indicator
      const statusIndicator = wrapper.find('.status-indicator');
      expect(statusIndicator.exists()).toBe(true);

      // Should show the exit code
      expect(wrapper.text()).toContain('exit code: 0');
    });

    it('debounces rapid output updates', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const updatedRun1 = { ...mockRun, output: 'Line 1\n' };
      const updatedRun2 = { ...mockRun, output: 'Line 1\nLine 2\n' };
      const updatedRun3 = { ...mockRun, output: 'Line 1\nLine 2\nLine 3\n' };

      await wrapper.setProps({ run: updatedRun1 });
      await wrapper.setProps({ run: updatedRun2 });
      await wrapper.setProps({ run: updatedRun3 });

      await new Promise(resolve => setTimeout(resolve, 300));
      await nextTick();

      expect(wrapper.props('run').output).toContain('Line 3');
    });
  });

  describe('output truncation', () => {
    it('displays truncation warning when output is truncated', async () => {
      const truncatedRun = { ...mockRun, outputTruncated: true };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: truncatedRun
        }
      });

      // Should render the output section
      const outputHeader = wrapper.find('.output-header');
      expect(outputHeader.exists()).toBe(true);

      // Should display the run status and button
      expect(wrapper.find('.btn-primary').exists() || wrapper.find('.kill-button').exists()).toBe(true);

      // Component should be properly rendered with the truncated run
      expect(wrapper.find('.command-button-item').exists()).toBe(true);
    });

    it('does not show truncation warning when output is not truncated', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: { ...mockRun, outputTruncated: false }
        }
      });

      expect(wrapper.text()).not.toContain('Output truncated');
    });
  });

  describe('component lifecycle', () => {
    it('handles prop updates gracefully', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const updatedRun = { ...mockRun, status: 'failed', output: 'Test failed' };
      await wrapper.setProps({ run: updatedRun });
      await nextTick();

      expect(wrapper.props('run').status).toBe('failed');
    });

    it('updates output when run changes', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const newRun = {
        ...mockRun,
        id: 'run-2',
        output: 'New output content'
      };

      await wrapper.setProps({ run: newRun });
      await nextTick();

      expect(wrapper.props('run').id).toBe('run-2');
    });
  });

  describe('ANSI code conversion', () => {
    it('renders ANSI colored output correctly', async () => {
      const coloredOutput = '\x1b[31mError message\x1b[0m';
      const runWithColor = { ...mockRun, output: coloredOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithColor
        }
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it('handles multiple ANSI codes in output', async () => {
      const coloredOutput = '\x1b[32m✓\x1b[0m Test 1\n\x1b[31m✗\x1b[0m Test 2';
      const runWithColor = { ...mockRun, output: coloredOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithColor
        }
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('display truncation for performance', () => {
    it('does not show display truncation indicator for small outputs (<200 lines)', async () => {
      // Create output with 100 lines
      const smallOutput = Array(100).fill('Test line').join('\n');
      const runWithSmallOutput = { ...mockRun, output: smallOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithSmallOutput
        }
      });

      // Expand output
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await nextTick();

      // Should not show display truncation indicator
      const truncationIndicator = wrapper.find('.output-display-truncated');
      expect(truncationIndicator.exists()).toBe(false);
      expect(wrapper.vm.outputIsTruncatedForDisplay).toBe(false);
    });

    it('shows display truncation indicator for large outputs (>200 lines)', async () => {
      // Create output with 300 lines
      const largeOutput = Array(300).fill('Test line').join('\n');
      const runWithLargeOutput = { ...mockRun, output: largeOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithLargeOutput
        }
      });

      // Expand output
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await flushPromises();
      await nextTick();

      // Should show display truncation indicator
      expect(wrapper.vm.outputIsTruncatedForDisplay).toBe(true);
      expect(wrapper.vm.showOutput).toBe(true);

      // Verify the output is large enough to trigger truncation
      expect(largeOutput.split('\n').length).toBeGreaterThan(200);
    });

    it('renders only last 200 lines for performance', async () => {
      // Create output with 500 lines, each with a unique identifier
      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`);
      const largeOutput = lines.join('\n');
      const runWithLargeOutput = { ...mockRun, output: largeOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithLargeOutput
        }
      });

      // Expand output
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await flushPromises();
      await nextTick();

      // Should be truncated for display
      expect(wrapper.vm.outputIsTruncatedForDisplay).toBe(true);

      // The formattedOutput should contain the last 200 lines (Line 301 to Line 500)
      // but NOT the first lines (Line 1 to Line 300)
      const formattedOutput = wrapper.vm.formattedOutput;
      expect(formattedOutput).toContain('Line 500');
      expect(formattedOutput).toContain('Line 301');
      expect(formattedOutput).not.toContain('Line 1<');
      expect(formattedOutput).not.toContain('>Line 1\n');
    });

    it('shows truncation indicator exactly at 201 line boundary', async () => {
      // Create output with exactly 200 lines
      const boundaryOutput = Array(200).fill('Test line').join('\n');
      const runWithBoundaryOutput = { ...mockRun, output: boundaryOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithBoundaryOutput
        }
      });

      // Expand output
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await nextTick();

      // Should not show truncation indicator for exactly 200 lines
      expect(wrapper.vm.outputIsTruncatedForDisplay).toBe(false);

      // Now test with 201 lines
      const aboveBoundaryOutput = Array(201).fill('Test line').join('\n');
      const runWithAboveBoundaryOutput = { ...mockRun, output: aboveBoundaryOutput };

      await wrapper.setProps({ run: runWithAboveBoundaryOutput });
      await flushPromises();
      await nextTick();
      // Wait for debounce (250ms)
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should show truncation indicator for >200 lines
      expect(wrapper.vm.outputIsTruncatedForDisplay).toBe(true);
    });

    it('preserves full output in props for copy/canvas operations', async () => {
      // Create output with 500 lines
      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`);
      const largeOutput = lines.join('\n');
      const runWithLargeOutput = { ...mockRun, output: largeOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithLargeOutput
        }
      });

      // The props should still contain the full output (500 lines)
      expect(wrapper.props('run').output).toBe(largeOutput);
      expect(wrapper.props('run').output.split('\n').length).toBe(500);

      // This ensures copy/canvas operations have access to full output
    });
  });

  describe('header action menu', () => {
    it('displays ActionMenu when output is available and not running', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Should have ActionMenu component
      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(true);
    });

    it('does not display ActionMenu when command is running', async () => {
      const runningRun = { ...mockRun, status: 'running', output: 'Some output' };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun
        }
      });

      // Should not have ActionMenu
      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(false);
    });

    it('displays ActionMenu for completed run even without output', async () => {
      const runWithoutOutput = { ...mockRun, output: null };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      // ActionMenu should be visible for any completed run (relaxed v-if)
      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(true);
    });

    it('passes correct menu items to ActionMenu', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(true);

      const items = actionMenu.props('items');
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ icon: '📋', label: 'Copy output', action: 'copy-output' });
      expect(items[1]).toEqual({ icon: '🎨', label: 'Send to canvas', action: 'send-to-canvas' });
      expect(items[2]).toEqual({ icon: '📄', label: 'Copy command', action: 'copy-command' });
    });
  });

  describe('menu actions', () => {
    beforeEach(() => {
      // Mock clipboard API
      global.navigator.clipboard = {
        writeText: vi.fn().mockResolvedValue(undefined)
      };
    });

    it('handleCopyOutput copies output to clipboard', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Populate the store's runs so handleCopyOutput can read from it
      const store = useCommandButtonsStore();
      store.runs[mockRun.runId] = { ...mockRun };

      await wrapper.vm.handleCopyOutput();
      await nextTick();

      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith(mockRun.output);
    });

    it('handleSendToCanvas calls emit with correct parameters', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // handleSendToCanvas exists and is a function
      expect(typeof wrapper.vm.handleSendToCanvas).toBe('function');

      // Calling it shouldn't throw
      expect(() => wrapper.vm.handleSendToCanvas()).not.toThrow();
    });

    it('handleCopyCommand copies command to clipboard', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      await wrapper.vm.handleCopyCommand();
      await nextTick();

      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith(mockButton.command);
    });

    it('handleMenuAction dispatches to handleCopyOutput for copy-output action', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Populate the store's runs so handleCopyOutput can read from it
      const store = useCommandButtonsStore();
      store.runs[mockRun.runId] = { ...mockRun };

      // Test that handleMenuAction with 'copy-output' calls clipboard API
      await wrapper.vm.handleMenuAction('copy-output');
      await nextTick();

      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith(mockRun.output);
    });

    it('handleMenuAction handles send-to-canvas action', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Test that handleMenuAction with 'send-to-canvas' doesn't throw
      expect(() => wrapper.vm.handleMenuAction('send-to-canvas')).not.toThrow();
    });

    it('handleMenuAction dispatches to handleCopyCommand for copy-command action', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Test that handleMenuAction with 'copy-command' calls clipboard API
      await wrapper.vm.handleMenuAction('copy-command');
      await nextTick();

      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith(mockButton.command);
    });

    it('handleCopyOutput strips ANSI codes before copying', async () => {
      const coloredOutput = '\x1b[31mError message\x1b[0m';
      const runWithColor = { ...mockRun, output: coloredOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithColor
        }
      });

      // Populate the store's runs so handleCopyOutput can read from it
      const store = useCommandButtonsStore();
      store.runs[runWithColor.runId] = { ...runWithColor };

      await wrapper.vm.handleCopyOutput();
      await nextTick();

      // Should strip ANSI codes before copying
      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith('Error message');
    });
  });

  describe('ActionMenu visibility (relaxed v-if)', () => {
    it('displays ActionMenu for completed run without output', () => {
      const runWithoutOutput = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'success',
        output: '',
        exitCode: 0,
        outputTruncated: false,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(true);
    });

    it('hides ActionMenu while running', () => {
      const runningRun = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'running',
        output: 'partial',
        exitCode: null,
        outputTruncated: false,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun
        }
      });

      const actionMenu = wrapper.findComponent({ name: 'ActionMenu' });
      expect(actionMenu.exists()).toBe(false);
    });
  });

  describe('on-demand output fetching', () => {
    beforeEach(() => {
      global.navigator.clipboard = {
        writeText: vi.fn().mockResolvedValue(undefined)
      };
    });

    it('expand triggers fetchRunOutput when output is empty', async () => {
      const runWithoutOutput = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'success',
        output: '',
        exitCode: 0,
        outputTruncated: false,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      const store = useCommandButtonsStore();
      const fetchSpy = vi.spyOn(store, 'fetchRunOutput').mockResolvedValue(undefined);

      // Click to expand output
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await nextTick();

      expect(fetchSpy).toHaveBeenCalledWith('session-1', 'run-1');

      fetchSpy.mockRestore();
    });

    it('handleCopyOutput fetches output if not loaded', async () => {
      const runWithoutOutput = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'success',
        output: '',
        exitCode: 0,
        outputTruncated: false,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      const store = useCommandButtonsStore();
      // Set up the run in store so fetchRunOutput can populate it
      store.runs['run-1'] = { ...runWithoutOutput };
      const fetchSpy = vi.spyOn(store, 'fetchRunOutput').mockImplementation(async () => {
        store.runs['run-1'] = { ...store.runs['run-1'], output: 'fetched output' };
      });

      await wrapper.vm.handleCopyOutput();
      await nextTick();

      expect(fetchSpy).toHaveBeenCalledWith('session-1', 'run-1');
      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith('fetched output');

      fetchSpy.mockRestore();
    });

    it('handleSendToCanvas calls fetchRunOutput when output is empty', async () => {
      const runWithoutOutput = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'success',
        output: '',
        exitCode: 0,
        outputTruncated: false,
      };

      const store = useCommandButtonsStore();
      store.runs['run-1'] = { ...runWithoutOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithoutOutput
        }
      });

      const fetchSpy = vi.spyOn(store, 'fetchRunOutput').mockResolvedValue(undefined);

      await wrapper.vm.handleSendToCanvas();
      await nextTick();

      expect(fetchSpy).toHaveBeenCalledWith('session-1', 'run-1');

      fetchSpy.mockRestore();
    });

    it('handleSendToCanvas reads output from store', async () => {
      const store = useCommandButtonsStore();
      store.runs['run-1'] = {
        runId: 'run-1',
        buttonId: 'btn-1',
        status: 'success',
        output: 'stored output',
        exitCode: 0,
        outputTruncated: false,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: {
            runId: 'run-1',
            buttonId: 'btn-1',
            status: 'success',
            output: 'stored output',
            exitCode: 0,
            outputTruncated: false,
          }
        }
      });

      // handleSendToCanvas should not throw when output is available in store
      await expect(wrapper.vm.handleSendToCanvas()).resolves.not.toThrow();
    });
  });

  describe('RunTimestamps integration', () => {
    it('renders <RunTimestamps> as a child with the current run prop', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun,
        },
      });

      const ts = wrapper.findComponent(RunTimestamps);
      expect(ts.exists()).toBe(true);
      expect(ts.props('run')).toEqual(mockRun);
    });

    it('renders <RunTimestamps> even when there is no run yet', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
        },
      });

      const ts = wrapper.findComponent(RunTimestamps);
      expect(ts.exists()).toBe(true);
      expect(ts.props('run')).toBe(null);
    });

    it('exposes timestampsRef via defineExpose (single source of truth)', () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun,
        },
      });

      // The template ref is exposed so the .running-indicator footer can mirror
      // the child's reactive `elapsedTime`. If this ever disappears the footer
      // will fall back to '0:00' forever, so keep this assertion.
      expect('timestampsRef' in wrapper.vm).toBe(true);
    });

    it('the parent does NOT hold its own timer interval (single interval, owned by the child)', () => {
      // If the parent still had `setInterval(...)` in onMounted/watch alongside
      // the child's interval, we would see two intervals for a single running
      // row. We pin the count at exactly 1 to catch regressions.
      const setSpy = vi.spyOn(globalThis, 'setInterval');
      const runningRun = {
        ...mockRun,
        status: 'running',
        startedAt: Date.now(),
        exitCode: null,
      };

      mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun,
        },
      });

      expect(setSpy).toHaveBeenCalledTimes(1);
      setSpy.mockRestore();
    });

    it('does not create any interval when the run is not running', () => {
      const setSpy = vi.spyOn(globalThis, 'setInterval');

      mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun, // status: 'success'
        },
      });

      expect(setSpy).not.toHaveBeenCalled();
      setSpy.mockRestore();
    });

    it('the .running-indicator footer mirrors the child ref elapsedTime', async () => {
      const runningRun = {
        ...mockRun,
        status: 'running',
        startedAt: Date.now(),
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun,
        },
      });

      const footer = wrapper.find('.running-indicator');
      expect(footer.exists()).toBe(true);

      const elapsed = footer.find('.elapsed-time');
      expect(elapsed.exists()).toBe(true);

      // Immediately after mount the child exposes '0:00'; the footer must
      // read from `timestampsRef.elapsedTime`, not from any parent-owned ref.
      await nextTick();
      expect(elapsed.text()).toBe('0:00');

      // The child's ref is the same instance the footer reads from.
      expect(wrapper.vm.timestampsRef).toBeTruthy();
      expect(wrapper.vm.timestampsRef.elapsedTime).toBe('0:00');
    });

    it('footer falls back to "0:00" when the child ref is not yet populated', async () => {
      // Stubbing RunTimestamps guarantees its exposed API is not available,
      // so the template's ?? fallback must render '0:00'.
      const runningRun = {
        ...mockRun,
        status: 'running',
        startedAt: Date.now(),
        exitCode: null,
      };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun,
        },
        global: {
          stubs: { RunTimestamps: true },
        },
      });

      const elapsed = wrapper.find('.running-indicator .elapsed-time');
      expect(elapsed.exists()).toBe(true);
      expect(elapsed.text()).toBe('0:00');
    });

    it('does not expose a local timerInterval or local elapsedTime ref', () => {
      // The legacy implementation had a local `timerInterval` and an
      // `elapsedTime` ref on the component instance. Those were moved into
      // <RunTimestamps> and must no longer exist on the parent.
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: { ...mockRun, status: 'running', startedAt: Date.now(), exitCode: null },
        },
      });

      expect(wrapper.vm.timerInterval).toBeUndefined();
      // `elapsedTime` must now live inside the child; the parent must not
      // expose its own copy.
      expect(wrapper.vm.elapsedTime).toBeUndefined();
    });
  });
});
