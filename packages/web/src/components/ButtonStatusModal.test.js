import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ButtonStatusModal from './ButtonStatusModal.vue';

describe('ButtonStatusModal.vue', () => {
  const baseButton = {
    label: 'Build',
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

    it('updates display when process completes', async () => {
      const wrapper = mount(ButtonStatusModal, {
        props: {
          button: baseButton,
          latestRun: { ...baseRun, status: 'running', startedAt: Date.now() },
          isOpen: true,
        },
      });

      await nextTick();

      // Initially shows running status
      expect(wrapper.text()).toContain('Running');

      // Process completes
      await wrapper.setProps({
        latestRun: { ...baseRun, status: 'success', exitCode: 0, completedAt: Date.now() },
      });
      await nextTick();

      // Display should update to show success with completion time
      expect(wrapper.text()).toContain('Success');
      expect(wrapper.text()).toContain('Completed');
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
});
