import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Mock useWebSocket composable
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('../../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: mockOn,
    off: mockOff,
    isConnected: { value: false },
    send: vi.fn(),
    disconnect: vi.fn(),
    clearSessionBuffer: vi.fn(),
  }),
}));

// Import component and utility after mocks
import SystemIndicators from '../SystemIndicators.vue';
import { getColorForPercent } from '../../utils/systemIndicators.js';

// Sample metrics payload
const sampleMetrics = {
  cpu: { usagePercent: 45.2 },
  memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 },
  disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 },
};

/**
 * Helper to get the registered metrics handler from mockOn calls.
 * Returns the callback registered for SYSTEM_METRICS.
 */
function getMetricsHandler() {
  const call = mockOn.mock.calls.find(
    ([type]) => type === WS_MESSAGE_TYPES.SYSTEM_METRICS
  );
  return call ? call[1] : null;
}

describe('SystemIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders nothing (hidden) before any WS message arrives', () => {
      const wrapper = mount(SystemIndicators);
      expect(wrapper.find('[data-testid="system-indicators"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('becomes visible after receiving metrics', async () => {
      const wrapper = mount(SystemIndicators);

      const handler = getMetricsHandler();
      expect(handler).toBeTruthy();

      // Simulate receiving metrics
      handler(sampleMetrics);
      await nextTick();

      expect(wrapper.find('[data-testid="system-indicators"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('registers a listener on mount', () => {
      const wrapper = mount(SystemIndicators);
      expect(mockOn).toHaveBeenCalledWith(WS_MESSAGE_TYPES.SYSTEM_METRICS, expect.any(Function));
      wrapper.unmount();
    });
  });

  describe('indicator elements', () => {
    it('shows CPU and memory indicators after data arrives', async () => {
      const wrapper = mount(SystemIndicators);

      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      expect(wrapper.find('[data-testid="indicator-cpu"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="indicator-memory"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows disk indicator when disk data is present', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      expect(wrapper.find('[data-testid="indicator-disk"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('hides disk indicator when disk is null', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler({ ...sampleMetrics, disk: null });
      await nextTick();

      expect(wrapper.find('[data-testid="indicator-disk"]').exists()).toBe(false);
      // CPU and memory still show
      expect(wrapper.find('[data-testid="indicator-cpu"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="indicator-memory"]').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('getColorForPercent utility', () => {
    it('returns --color-success for 0%', () => {
      expect(getColorForPercent(0)).toBe('var(--color-success)');
    });

    it('returns --color-success for 59%', () => {
      expect(getColorForPercent(59)).toBe('var(--color-success)');
    });

    it('returns --color-warning for 60%', () => {
      expect(getColorForPercent(60)).toBe('var(--color-warning)');
    });

    it('returns --color-warning for 79%', () => {
      expect(getColorForPercent(79)).toBe('var(--color-warning)');
    });

    it('returns --color-error for 80%', () => {
      expect(getColorForPercent(80)).toBe('var(--color-error)');
    });

    it('returns --color-error for 100%', () => {
      expect(getColorForPercent(100)).toBe('var(--color-error)');
    });
  });

  describe('tooltip text formatting', () => {
    it('formats CPU title correctly', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      const cpuEl = wrapper.find('[data-testid="indicator-cpu"]');
      expect(cpuEl.attributes('title')).toBe('CPU: 45%');
      wrapper.unmount();
    });

    it('formats memory title correctly', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      const memEl = wrapper.find('[data-testid="indicator-memory"]');
      expect(memEl.attributes('title')).toBe('RAM: 6.2 / 16.0 GB');
      wrapper.unmount();
    });

    it('formats disk title correctly', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      const diskEl = wrapper.find('[data-testid="indicator-disk"]');
      expect(diskEl.attributes('title')).toBe('Disk: 234 GB free');
      wrapper.unmount();
    });
  });

  describe('null disk graceful handling', () => {
    it('does not crash when disk is null', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();

      expect(() => {
        handler({ ...sampleMetrics, disk: null });
      }).not.toThrow();

      await nextTick();

      // Component still renders CPU and memory
      expect(wrapper.find('[data-testid="system-indicators"]').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('listener cleanup on unmount', () => {
    it('calls off() with the same type and handler reference on unmount', async () => {
      const wrapper = mount(SystemIndicators);

      // Capture the handler that was registered
      const registeredType = mockOn.mock.calls[0][0];
      const registeredHandler = mockOn.mock.calls[0][1];

      expect(registeredType).toBe(WS_MESSAGE_TYPES.SYSTEM_METRICS);

      // Unmount the component
      wrapper.unmount();

      // Verify off() was called with the same type and handler
      expect(mockOff).toHaveBeenCalledWith(
        WS_MESSAGE_TYPES.SYSTEM_METRICS,
        registeredHandler
      );
    });

    it('does not call off() before unmounting', () => {
      const wrapper = mount(SystemIndicators);
      expect(mockOff).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  describe('bar styles', () => {
    it('CPU bar has correct width percentage', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      const cpuBar = wrapper.find('[data-testid="indicator-bar-cpu"]');
      expect(cpuBar.attributes('style')).toContain('width: 45.2%');
      wrapper.unmount();
    });

    it('memory bar has correct width percentage', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler(sampleMetrics);
      await nextTick();

      const memBar = wrapper.find('[data-testid="indicator-bar-memory"]');
      expect(memBar.attributes('style')).toContain('width: 62.1%');
      wrapper.unmount();
    });

    it('CPU bar has success color for low usage', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler({ ...sampleMetrics, cpu: { usagePercent: 30 } });
      await nextTick();

      const cpuBar = wrapper.find('[data-testid="indicator-bar-cpu"]');
      expect(cpuBar.attributes('style')).toContain('var(--color-success)');
      wrapper.unmount();
    });

    it('CPU bar has warning color for medium usage', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler({ ...sampleMetrics, cpu: { usagePercent: 70 } });
      await nextTick();

      const cpuBar = wrapper.find('[data-testid="indicator-bar-cpu"]');
      expect(cpuBar.attributes('style')).toContain('var(--color-warning)');
      wrapper.unmount();
    });

    it('CPU bar has error color for high usage', async () => {
      const wrapper = mount(SystemIndicators);
      const handler = getMetricsHandler();
      handler({ ...sampleMetrics, cpu: { usagePercent: 90 } });
      await nextTick();

      const cpuBar = wrapper.find('[data-testid="indicator-bar-cpu"]');
      expect(cpuBar.attributes('style')).toContain('var(--color-error)');
      wrapper.unmount();
    });
  });
});
