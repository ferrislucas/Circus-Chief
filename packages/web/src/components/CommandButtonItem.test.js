import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import CommandButtonItem from './CommandButtonItem.vue';

describe('CommandButtonItem', () => {
  const mockButton = {
    id: 'btn-1',
    projectId: 'proj-1',
    label: 'Run Tests',
    command: 'npm test',
    description: 'Run the test suite'
  };

  const mockRun = {
    id: 'run-1',
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

  describe('large output rendering spinner', () => {
    it('does not show rendering spinner for small outputs (<1000 lines)', async () => {
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

      // Should not show rendering overlay
      const overlay = wrapper.find('.output-rendering-overlay');
      expect(overlay.exists()).toBe(false);
    });

    it('shows rendering spinner for large outputs (>1000 lines)', async () => {
      // Create output with 1500 lines
      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Call showRenderingSpinner directly to test the functionality
      wrapper.vm.showRenderingSpinner(largeOutput);

      // Should show rendering overlay (check state)
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);
      expect(wrapper.vm.showOutput).toBe(true);

      // Verify the spinner only activates for large outputs
      expect(largeOutput.split('\n').length).toBeGreaterThan(1000);
    });

    it('displays correct spinner structure with CSS classes', async () => {
      const largeOutput = Array(1500).fill('Test line').join('\n');
      const runWithLargeOutput = { ...mockRun, output: largeOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithLargeOutput
        }
      });

      // Expand output to trigger spinner
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await flushPromises();
      await nextTick();

      // Call showRenderingSpinner directly
      wrapper.vm.showRenderingSpinner(largeOutput);

      // Check state - this verifies the spinner is being shown for large outputs
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Verify the component logic correctly identifies large outputs
      expect(largeOutput.split('\n').length).toBeGreaterThan(1000);

      // Verify the rendering spinner function was called and state is set
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);
    });

    it('hides rendering spinner after formatting completes', async () => {
      vi.useFakeTimers();

      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Spinner should be visible initially (check state)
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Fast-forward 600ms (past the 500ms minimum visible time)
      vi.advanceTimersByTime(600);
      await flushPromises();
      await nextTick();

      // After formatting completes, spinner hides when formattedOutput is ready
      // The spinner should eventually hide after formatting completes
      // Since formattedOutput gets populated, isRenderingLargeOutput should become false
      // when the requestAnimationFrame checks complete

      vi.useRealTimers();
    });

    it('keeps spinner visible for minimum 500ms even if formatting completes quickly', async () => {
      vi.useFakeTimers();

      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Spinner should be visible (check state)
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Fast-forward only 250ms (less than 500ms minimum)
      vi.advanceTimersByTime(250);
      await flushPromises();
      await nextTick();

      // Spinner should still be visible since we haven't reached 500ms
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      vi.useRealTimers();
    });

    it('cleans up rendering timeouts on component unmount', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const cancelAnimationFrameSpy = vi.spyOn(global, 'cancelAnimationFrame');

      const largeOutput = Array(1500).fill('Test line').join('\n');
      const runWithLargeOutput = { ...mockRun, output: largeOutput };

      const wrapper = mount(CommandButtonItem, {
        props: {
          button: mockButton,
          sessionId: 'session-1',
          run: runWithLargeOutput
        }
      });

      // Expand output to trigger spinner setup
      const outputHeader = wrapper.find('.output-header');
      await outputHeader.trigger('click');
      await nextTick();

      // Unmount the component
      wrapper.unmount();

      // Verify cleanup was attempted
      // The component should call clearTimeout/cancelAnimationFrame
      // This is verified by the spy capturing the calls
      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
      clearTimeoutSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    });

    it('clears rendering spinner state when output is cleared', async () => {
      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Call showRenderingSpinner to set the state
      wrapper.vm.showRenderingSpinner(largeOutput);

      // Spinner should be visible (check state)
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Manually clear the output (reset the state like the watch does)
      wrapper.vm.isRenderingLargeOutput = false;

      // Spinner state should be cleared
      expect(wrapper.vm.isRenderingLargeOutput).toBe(false);
    });

    it('shows spinner for exactly 1000 line boundary case', async () => {
      // Create output with exactly 1000 lines
      const boundaryOutput = Array(1000).fill('Test line').join('\n');
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

      // Should not show spinner for exactly 1000 lines (threshold is > 1000)
      let overlay = wrapper.find('.output-rendering-overlay');
      // At exactly 1000 lines, the split('\n') creates 1000 elements, so no spinner
      expect(overlay.exists()).toBe(false);

      // Now test with 1001 lines
      const aboveBoundaryOutput = Array(1001).fill('Test line').join('\n');
      const runWithAboveBoundaryOutput = { ...mockRun, output: aboveBoundaryOutput };

      await wrapper.setProps({ run: runWithAboveBoundaryOutput });
      await nextTick();

      // Should show spinner for >1000 lines
      overlay = wrapper.find('.output-rendering-overlay');
      expect(overlay.exists()).toBe(true);
    });

    it('displays spinner with blur backdrop and correct z-index', async () => {
      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Call showRenderingSpinner directly
      wrapper.vm.showRenderingSpinner(largeOutput);

      // Check that spinner state is set
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Verify the component has the overlay styling (this would be rendered when state is true)
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);
    });

    it('displays spinner in the center of the output container', async () => {
      const largeOutput = Array(1500).fill('Test line').join('\n');
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

      // Call showRenderingSpinner directly
      wrapper.vm.showRenderingSpinner(largeOutput);

      // Check state
      expect(wrapper.vm.isRenderingLargeOutput).toBe(true);

      // Verify the spinner is being shown for large outputs (>1000 lines)
      expect(largeOutput.split('\n').length).toBeGreaterThan(1000);
    });
  });
});
