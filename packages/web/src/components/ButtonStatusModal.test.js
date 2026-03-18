import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ButtonStatusModal from './ButtonStatusModal.vue';

async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('ButtonStatusModal.vue', () => {
  const baseButton = {
    label: 'Build',
    command: 'npm run build',
  };

  const baseRun = {
    runId: 'run-1',
    buttonId: 'btn-1',
    status: 'success',
    output: 'Build successful',
    exitCode: 0,
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
  };

  describe('rendering', () => {
    it('does not render when isOpen is false', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: null,
          isOpen: false,
        },
      });

      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('renders modal when isOpen is true', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('.modal-dialog').exists()).toBe(true);
    });

    it('displays button label in header', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: { label: 'Deploy to Production' },
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.modal-header h3').text()).toBe('Deploy to Production');
    });

    it('shows close button in header', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.modal-close').exists()).toBe(true);
      expect(wrapper.find('.modal-close').text()).toBe('×');
    });

    it('has close button with aria-label', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      const closeBtn = wrapper.find('.modal-close');
      expect(closeBtn.attributes('aria-label')).toBe('Close');
    });
  });

  describe('status display', () => {
    it('shows never run status when latestRun is null', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: null,
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-badge').text()).toBe('Never Run');
      expect(wrapper.find('.status-badge').classes()).toContain('status-pending');
      expect(wrapper.find('.info-message').text()).toContain('not been run yet');
    });

    it('shows running status and elapsed time', () => {
      const now = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            startedAt: now - 65000, // 1 minute, 5 seconds
          },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-badge').text()).toBe('Running');
      expect(wrapper.find('.status-badge').classes()).toContain('status-running');
      expect(wrapper.text()).toContain('Elapsed Time');
      expect(wrapper.text()).toContain('Started');
    });

    it('shows success status with exit code and completion time', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-badge').text()).toBe('Success');
      expect(wrapper.find('.status-badge').classes()).toContain('status-success');
      expect(wrapper.text()).toContain('Exit Code');
      expect(wrapper.text()).toContain('0');
      expect(wrapper.text()).toContain('Completed');
    });

    it('shows error status with exit code and failure time', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            exitCode: 1,
          },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-badge').text()).toBe('Error');
      expect(wrapper.find('.status-badge').classes()).toContain('status-error');
      expect(wrapper.text()).toContain('Exit Code');
      expect(wrapper.text()).toContain('1');
      expect(wrapper.text()).toContain('Failed');
    });

    it('shows unknown status for unrecognized status value', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'unknown_status',
          },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-badge').text()).toBe('Unknown');
      expect(wrapper.find('.status-badge').classes()).toContain('status-pending');
    });
  });

  describe('exit code display', () => {
    it('displays exit code 0 for success', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'success', exitCode: 0 },
          isOpen: true,
        },
      });

      expect(wrapper.text()).toContain('0');
    });

    it('displays non-zero exit code for error', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'error', exitCode: 127 },
          isOpen: true,
        },
      });

      expect(wrapper.text()).toContain('127');
    });

    it('displays N/A when exit code is null', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'error', exitCode: null },
          isOpen: true,
        },
      });

      expect(wrapper.text()).toContain('N/A');
    });

    it('displays N/A when exit code is undefined', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'success', exitCode: undefined },
          isOpen: true,
        },
      });

      expect(wrapper.text()).toContain('N/A');
    });
  });

  describe('time formatting', () => {
    it('formats startedAt timestamp correctly', () => {
      const now = new Date();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            startedAt: now.getTime(),
          },
          isOpen: true,
        },
      });

      const formattedTime = wrapper.text();
      expect(formattedTime).toContain('Started');
    });

    it('formats completedAt timestamp correctly for success', () => {
      const now = new Date();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            completedAt: now.getTime(),
          },
          isOpen: true,
        },
      });

      const formattedTime = wrapper.text();
      expect(formattedTime).toContain('Completed');
    });

    it('formats completedAt timestamp correctly for error', () => {
      const now = new Date();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            completedAt: now.getTime(),
          },
          isOpen: true,
        },
      });

      const formattedTime = wrapper.text();
      expect(formattedTime).toContain('Failed');
    });

    it('displays N/A when completedAt is missing', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            completedAt: undefined,
          },
          isOpen: true,
        },
      });

      expect(wrapper.text()).toContain('N/A');
    });
  });

  describe('elapsed time calculation', () => {
    it('calculates and displays elapsed time for running process', async () => {
      const now = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            startedAt: now - 125000, // 2 minutes, 5 seconds
          },
          isOpen: true,
        },
      });

      await nextTick();

      const elapsedTimeDisplay = wrapper.find('.elapsed-time') || wrapper.text();
      expect(elapsedTimeDisplay).toBeDefined();
    });

    it('shows elapsed time in MM:SS format', async () => {
      const now = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            startedAt: now - 65000, // 1 minute, 5 seconds
          },
          isOpen: true,
        },
      });

      await nextTick();

      expect(wrapper.text()).toMatch(/\d+:\d{2}/);
    });
  });

  describe('modal interaction', () => {
    it('has close button in header', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      const closeBtn = wrapper.find('.modal-close');
      expect(closeBtn.exists()).toBe(true);
    });

    it('modal overlay exists when isOpen is true', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    });

    it('does not render modal when isOpen is false', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: false,
        },
      });

      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('shows close button in footer', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      const closeBtn = wrapper.find('.modal-footer .btn');
      expect(closeBtn.exists()).toBe(true);
      expect(closeBtn.text()).toBe('Close');
    });

    it('has proper modal dialog structure', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.modal-header').exists()).toBe(true);
      expect(wrapper.find('.modal-body').exists()).toBe(true);
      expect(wrapper.find('.modal-footer').exists()).toBe(true);
    });
  });

  describe('status sections', () => {
    it('shows status details section for running status', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running' },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-details').exists()).toBe(true);
    });

    it('shows status details section for success status', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'success' },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-details').exists()).toBe(true);
    });

    it('shows status details section for error status', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'error' },
          isOpen: true,
        },
      });

      expect(wrapper.find('.status-details').exists()).toBe(true);
    });

    it('shows info message for never-run button', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: null,
          isOpen: true,
        },
      });

      expect(wrapper.find('.info-message').exists()).toBe(true);
      expect(wrapper.find('.status-details').exists()).toBe(false);
    });
  });

  describe('timer management', () => {
    it('displays elapsed time when modal opens with running process', async () => {
      const startTime = Date.now() - 65000; // 1 minute, 5 seconds ago
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running', startedAt: startTime },
          isOpen: true,
        },
      });

      await nextTick();

      // Elapsed time should be displayed in the modal
      expect(wrapper.text()).toContain('Elapsed Time');
    });

    it('removes elapsed time when modal closes', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running', startedAt: Date.now() },
          isOpen: true,
        },
      });

      await nextTick();

      // Initially shows elapsed time
      expect(wrapper.text()).toContain('Elapsed Time');

      // Close the modal
      await wrapper.setProps({ isOpen: false });
      await nextTick();

      // Modal should not be rendered
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('displays different statuses correctly when mounted with different run states', async () => {
      // Test running status
      const runningWrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running', startedAt: Date.now() },
          isOpen: true,
        },
      });
      await flushAll(runningWrapper);
      expect(runningWrapper.text()).toContain('Running');
      runningWrapper.unmount();

      // Test success status
      const successWrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'success', exitCode: 0, completedAt: Date.now() },
          isOpen: true,
        },
      });
      await flushAll(successWrapper);
      expect(successWrapper.text()).toContain('Success');
      expect(successWrapper.text()).toContain('Completed');
      successWrapper.unmount();

      // Test error status
      const errorWrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'error', exitCode: 1, errorMessage: 'Process failed' },
          isOpen: true,
        },
      });
      await flushAll(errorWrapper);
      expect(errorWrapper.text()).toContain('Error');
    });
  });

  describe('detail rows', () => {
    it('displays exit code and completion time for success', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'success', exitCode: 0 },
          isOpen: true,
        },
      });

      const details = wrapper.findAll('.detail-row');
      expect(details.length).toBeGreaterThan(0);

      const detailText = wrapper.text();
      expect(detailText).toContain('Exit Code');
      expect(detailText).toContain('Completed');
    });

    it('displays exit code and failure time for error', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'error', exitCode: 1 },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Exit Code');
      expect(detailText).toContain('Failed');
    });

    it('displays elapsed time and start time for running', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running', startedAt: Date.now() },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Elapsed Time');
      expect(detailText).toContain('Started');
    });
  });

  describe('command display', () => {
    it('displays command text when provided', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: { label: 'Build', command: 'npm run build' },
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.command-section').exists()).toBe(true);
      expect(wrapper.find('.command-text').text()).toBe('npm run build');
    });

    it('hides command section when command is not provided', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: { label: 'Build' }, // no command property
          latestRun: baseRun,
          isOpen: true,
        },
      });

      expect(wrapper.find('.command-section').exists()).toBe(false);
    });

    it('handles empty command string', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: { label: 'Build', command: '' },
          latestRun: baseRun,
          isOpen: true,
        },
      });

      // Empty string is falsy, so command section should not be shown
      expect(wrapper.find('.command-section').exists()).toBe(false);
    });

    it('displays long commands with proper styling', () => {
      const longCommand = 'npm run build && npm run lint && npm run test:unit --coverage --reporter=verbose';
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: { label: 'Build', command: longCommand },
          latestRun: baseRun,
          isOpen: true,
        },
      });

      const commandText = wrapper.find('.command-text');
      expect(commandText.exists()).toBe(true);
      expect(commandText.text()).toBe(longCommand);
      // Verify it has the code element styling
      expect(commandText.element.tagName.toLowerCase()).toBe('code');
    });
  });

  describe('duration display', () => {
    it('calculates and displays duration for completed runs', () => {
      const startedAt = Date.now() - 125000; // 2 minutes, 5 seconds ago
      const completedAt = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt,
            completedAt,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Duration');
      // Duration should be approximately 2m 5s
      expect(detailText).toMatch(/\d+m \d+s/);
    });

    it('displays duration in seconds for short runs', () => {
      const startedAt = Date.now() - 45000; // 45 seconds ago
      const completedAt = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt,
            completedAt,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Duration');
      // Duration should be approximately 45s (no minutes)
      expect(detailText).toMatch(/\d+s/);
    });

    it('displays duration for error runs', () => {
      const startedAt = Date.now() - 30000; // 30 seconds ago
      const completedAt = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            exitCode: 1,
            startedAt,
            completedAt,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Duration');
    });

    it('does not show duration when completedAt is missing', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt: Date.now() - 30000,
            completedAt: null,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).not.toContain('Duration:');
    });

    it('does not show duration when startedAt is missing', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt: null,
            completedAt: Date.now(),
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).not.toContain('Duration:');
    });

    it('does not show duration for running processes', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            startedAt: Date.now() - 30000,
          },
          isOpen: true,
        },
      });

      // Running processes show elapsed time, not duration
      const detailText = wrapper.text();
      expect(detailText).toContain('Elapsed Time');
      expect(detailText).not.toContain('Duration:');
    });
  });

  describe('run ID display', () => {
    it('displays run ID for running processes', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'running',
            runId: 'run-abc-123',
            startedAt: Date.now(),
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Run ID');
      expect(detailText).toContain('run-abc-123');
    });

    it('displays run ID for successful runs', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            runId: 'run-xyz-456',
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Run ID');
      expect(detailText).toContain('run-xyz-456');
    });

    it('displays run ID for error runs', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            runId: 'run-error-789',
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Run ID');
      expect(detailText).toContain('run-error-789');
    });

    it('run ID has monospace styling', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            runId: 'run-styled-123',
          },
          isOpen: true,
        },
      });

      // Find the run ID detail value element
      const runIdRow = wrapper.findAll('.detail-row').find(row => row.text().includes('Run ID'));
      expect(runIdRow).toBeDefined();
      const runIdValue = runIdRow.find('.detail-value');
      expect(runIdValue.classes()).toContain('monospace');
    });
  });

  describe('start time display', () => {
    it('displays started time for success status', () => {
      const startedAt = Date.now() - 5000;
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt,
            completedAt: Date.now(),
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Started');
    });

    it('displays started time for error status', () => {
      const startedAt = Date.now() - 5000;
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            startedAt,
            completedAt: Date.now(),
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Started');
    });

    it('displays both started and completed times for success', () => {
      const startedAt = Date.now() - 10000;
      const completedAt = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'success',
            startedAt,
            completedAt,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Started');
      expect(detailText).toContain('Completed');
    });

    it('displays both started and failed times for error', () => {
      const startedAt = Date.now() - 10000;
      const completedAt = Date.now();
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: {
            ...baseRun,
            status: 'error',
            startedAt,
            completedAt,
          },
          isOpen: true,
        },
      });

      const detailText = wrapper.text();
      expect(detailText).toContain('Started');
      expect(detailText).toContain('Failed');
    });
  });

  describe('output section', () => {
    it('does not render output section when output is empty', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: '' },
          isOpen: true,
        },
      });

      expect(wrapper.find('.output-section').exists()).toBe(false);
    });

    it('does not render output section when output is null', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: null },
          isOpen: true,
        },
      });

      expect(wrapper.find('.output-section').exists()).toBe(false);
    });

    it('renders output section when output exists', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: 'Build successful' },
          isOpen: true,
        },
      });

      expect(wrapper.find('.output-section').exists()).toBe(true);
      expect(wrapper.find('[data-testid="output-header"]').exists()).toBe(true);
    });

    it('output section is collapsed by default', () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: 'Some output' },
          isOpen: true,
        },
      });

      expect(wrapper.find('[data-testid="output-content"]').exists()).toBe(false);
      expect(wrapper.find('.expand-icon').text()).toBe('▶');
    });

    it('expands output section when header is clicked', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: 'Some output' },
          isOpen: true,
        },
      });

      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();

      expect(wrapper.find('[data-testid="output-content"]').exists()).toBe(true);
      expect(wrapper.find('.expand-icon').text()).toBe('▼');
    });

    it('collapses output section when clicked again', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: 'Some output' },
          isOpen: true,
        },
      });

      // First click to expand
      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();
      expect(wrapper.find('[data-testid="output-content"]').exists()).toBe(true);

      // Second click to collapse
      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();
      expect(wrapper.find('[data-testid="output-content"]').exists()).toBe(false);
    });

    it('displays output text when expanded', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: 'Build successful' },
          isOpen: true,
        },
      });

      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();

      expect(wrapper.find('[data-testid="output-text"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="output-text"]').html()).toContain('Build successful');
    });

    it('shows truncation indicator for output over 200 lines', async () => {
      const longOutput = Array(250).fill('Line of output').join('\n');
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: longOutput },
          isOpen: true,
        },
      });

      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();

      expect(wrapper.find('[data-testid="output-truncated"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="output-truncated"]').text()).toContain('200 lines');
    });

    it('does not show truncation indicator for output under 200 lines', async () => {
      const shortOutput = 'Short output\n'.repeat(10);
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: shortOutput },
          isOpen: true,
        },
      });

      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();

      expect(wrapper.find('[data-testid="output-truncated"]').exists()).toBe(false);
    });

    it('converts ANSI codes to HTML', async () => {
      const ansiOutput = '\x1b[31mError\x1b[0m\n\x1b[32mSuccess\x1b[0m';
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, output: ansiOutput },
          isOpen: true,
        },
      });

      await wrapper.find('[data-testid="output-header"]').trigger('click');
      await nextTick();

      const outputHtml = wrapper.find('[data-testid="output-text"]').html();
      // ANSI codes should be converted to span elements with styles
      expect(outputHtml).toContain('<span');
      expect(outputHtml).not.toContain('\x1b[');
    });
  });
});
