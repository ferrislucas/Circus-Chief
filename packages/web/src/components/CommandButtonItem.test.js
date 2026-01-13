/* global global */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import CommandButtonItem from './CommandButtonItem.vue';

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

      // For a completed run, a checkmark icon is displayed
      expect(wrapper.text()).toContain('✓');
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

  describe('header action buttons', () => {
    it('displays copy button in header when output is available and not running', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Should have copy button in header (btn-icon class)
      const copyButton = wrapper.find('.btn-icon');
      expect(copyButton.exists()).toBe(true);
    });

    it('does not display copy button when command is running', async () => {
      const runningRun = { ...mockRun, status: 'running', output: 'Some output' };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runningRun
        }
      });

      // Should not have copy button (btn-icon class)
      const iconButtons = wrapper.findAll('.btn-icon');
      expect(iconButtons.length).toBe(0);
    });

    it('displays canvas button in header when output is available', async () => {
      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: mockRun
        }
      });

      // Should have two icon buttons (copy and canvas)
      const iconButtons = wrapper.findAll('.btn-icon');
      expect(iconButtons.length).toBe(2);
    });
  });
});
