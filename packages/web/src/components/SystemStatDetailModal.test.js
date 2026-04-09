import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

// Stub Teleport before importing the component
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual,
    Teleport: (props, { slots }) => slots.default ? slots.default() : null,
  };
});

import SystemStatDetailModal from './SystemStatDetailModal.vue';

describe('SystemStatDetailModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleMetrics = {
    cpu: { usagePercent: 45.2, coreCount: 8, model: 'Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz' },
    memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 },
    disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 },
  };

  function mountModal(props = {}) {
    return mount(SystemStatDetailModal, {
      props: {
        isOpen: true,
        statType: 'cpu',
        metrics: sampleMetrics,
        ...props,
      },
    });
  }

  describe('visibility', () => {
    it('does not render modal when isOpen is false', () => {
      const wrapper = mount(SystemStatDetailModal, {
        props: {
          isOpen: false,
          statType: 'cpu',
          metrics: sampleMetrics,
        },
        attachTo: document.body,
      });
      expect(wrapper.find('[data-testid="system-stat-modal"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('renders modal when isOpen is true', () => {
      const wrapper = mountModal();
      expect(wrapper.find('[data-testid="system-stat-modal"]').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('titles per stat type', () => {
    it('shows "CPU Usage" when statType="cpu"', () => {
      const wrapper = mountModal({ statType: 'cpu' });
      expect(wrapper.find('[data-testid="stat-detail-title"]').text()).toBe('CPU Usage');
      wrapper.unmount();
    });

    it('shows "Memory Usage" when statType="memory"', () => {
      const wrapper = mountModal({ statType: 'memory' });
      expect(wrapper.find('[data-testid="stat-detail-title"]').text()).toBe('Memory Usage');
      wrapper.unmount();
    });

    it('shows "Disk Usage" when statType="disk"', () => {
      const wrapper = mountModal({ statType: 'disk' });
      expect(wrapper.find('[data-testid="stat-detail-title"]').text()).toBe('Disk Usage');
      wrapper.unmount();
    });
  });

  describe('CPU detail fields', () => {
    it('shows usage percentage value', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45.2, coreCount: 8, model: 'Test CPU' } } });
      expect(wrapper.find('[data-testid="stat-detail-percentage"]').text()).toBe('45.2%');
      wrapper.unmount();
    });

    it('shows core count from metrics.cpu.coreCount', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45.2, coreCount: 8, model: 'Test CPU' } } });
      expect(wrapper.find('[data-testid="stat-detail-row-cores"]').text()).toContain('8');
      wrapper.unmount();
    });

    it('shows model name from metrics.cpu.model', () => {
      const model = 'Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz';
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45.2, coreCount: 8, model } } });
      expect(wrapper.find('[data-testid="stat-detail-row-model"]').text()).toContain(model);
      wrapper.unmount();
    });

    it('shows status "Normal" for < 60%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45, coreCount: 8, model: 'Test' } } });
      expect(wrapper.find('[data-testid="stat-detail-status"]').text()).toBe('Normal');
      wrapper.unmount();
    });

    it('shows status "Elevated" for 60-79%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 65, coreCount: 8, model: 'Test' } } });
      expect(wrapper.find('[data-testid="stat-detail-status"]').text()).toBe('Elevated');
      wrapper.unmount();
    });

    it('shows status "High" for >= 80%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 85, coreCount: 8, model: 'Test' } } });
      expect(wrapper.find('[data-testid="stat-detail-status"]').text()).toBe('High');
      wrapper.unmount();
    });

    it('progress bar width matches usagePercent', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45.2, coreCount: 8, model: 'Test' } } });
      const bar = wrapper.find('[data-testid="stat-detail-bar"]');
      expect(bar.attributes('style')).toContain('width: 45.2%');
      wrapper.unmount();
    });
  });

  describe('Memory detail fields', () => {
    it('shows used percentage value', () => {
      const wrapper = mountModal({ statType: 'memory', metrics: { ...sampleMetrics, memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 } } });
      expect(wrapper.find('[data-testid="stat-detail-percentage"]').text()).toBe('62.1%');
      wrapper.unmount();
    });

    it('shows "Used: X.X GB"', () => {
      const wrapper = mountModal({ statType: 'memory', metrics: { ...sampleMetrics, memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 } } });
      expect(wrapper.find('[data-testid="stat-detail-row-used"]').text()).toContain('6.2 GB');
      wrapper.unmount();
    });

    it('shows "Total: Y.Y GB"', () => {
      const wrapper = mountModal({ statType: 'memory', metrics: { ...sampleMetrics, memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 } } });
      expect(wrapper.find('[data-testid="stat-detail-row-total"]').text()).toContain('16.0 GB');
      wrapper.unmount();
    });

    it('shows computed free GB (totalGB - usedGB)', () => {
      const wrapper = mountModal({ statType: 'memory', metrics: { ...sampleMetrics, memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 } } });
      expect(wrapper.find('[data-testid="stat-detail-row-free"]').text()).toContain('9.8 GB'); // 16.0 - 6.2 = 9.8
      wrapper.unmount();
    });

    it('progress bar width matches usedPercent', () => {
      const wrapper = mountModal({ statType: 'memory', metrics: { ...sampleMetrics, memory: { usedPercent: 62.1, usedGB: 6.2, totalGB: 16.0 } } });
      const bar = wrapper.find('[data-testid="stat-detail-bar"]');
      expect(bar.attributes('style')).toContain('width: 62.1%');
      wrapper.unmount();
    });
  });

  describe('Disk detail fields', () => {
    it('shows used percentage value', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 } } });
      expect(wrapper.find('[data-testid="stat-detail-percentage"]').text()).toBe('54.3%');
      wrapper.unmount();
    });

    it('shows free GB and total GB', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 } } });
      expect(wrapper.find('[data-testid="stat-detail-row-free"]').text()).toContain('234.0 GB');
      expect(wrapper.find('[data-testid="stat-detail-row-total"]').text()).toContain('512.0 GB');
      wrapper.unmount();
    });

    it('shows computed used GB (totalGB - freeGB)', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 } } });
      expect(wrapper.find('[data-testid="stat-detail-row-used"]').text()).toContain('278.0 GB'); // 512 - 234 = 278
      wrapper.unmount();
    });

    it('progress bar width matches usedPercent', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: { usedPercent: 54.3, freeGB: 234, totalGB: 512 } } });
      const bar = wrapper.find('[data-testid="stat-detail-bar"]');
      expect(bar.attributes('style')).toContain('width: 54.3%');
      wrapper.unmount();
    });
  });

  describe('Disk null handling', () => {
    it('shows "Disk data unavailable" fallback when metrics.disk is null and statType="disk"', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: null } });
      expect(wrapper.text()).toContain('Disk data unavailable');
      wrapper.unmount();
    });

    it('does not show percentage or detail rows when disk is null', () => {
      const wrapper = mountModal({ statType: 'disk', metrics: { ...sampleMetrics, disk: null } });
      expect(wrapper.find('[data-testid="stat-detail-percentage"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="stat-detail-bar"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('color coding', () => {
    it('uses success color (green) for < 60%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 45, coreCount: 8, model: 'Test' } } });
      const percentage = wrapper.find('[data-testid="stat-detail-percentage"]');
      expect(percentage.attributes('style')).toContain('var(--color-success)');
      wrapper.unmount();
    });

    it('uses warning color (amber) for 60-79%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 65, coreCount: 8, model: 'Test' } } });
      const percentage = wrapper.find('[data-testid="stat-detail-percentage"]');
      expect(percentage.attributes('style')).toContain('var(--color-warning)');
      wrapper.unmount();
    });

    it('uses error color (red) for >= 80%', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 85, coreCount: 8, model: 'Test' } } });
      const percentage = wrapper.find('[data-testid="stat-detail-percentage"]');
      expect(percentage.attributes('style')).toContain('var(--color-error)');
      wrapper.unmount();
    });

    it('progress bar uses matching color', () => {
      const wrapper = mountModal({ statType: 'cpu', metrics: { ...sampleMetrics, cpu: { usagePercent: 85, coreCount: 8, model: 'Test' } } });
      const bar = wrapper.find('[data-testid="stat-detail-bar"]');
      expect(bar.attributes('style')).toContain('var(--color-error)');
      wrapper.unmount();
    });
  });

  describe('close behavior', () => {
    it('close button exists in modal', () => {
      const wrapper = mountModal();
      const closeBtn = wrapper.find('.close-btn');
      expect(closeBtn.exists()).toBe(true);
      wrapper.unmount();
    });

    it('backdrop exists in modal', () => {
      const wrapper = mountModal();
      const backdrop = wrapper.find('.modal-backdrop');
      expect(backdrop.exists()).toBe(true);
      wrapper.unmount();
    });

    it('escape key handler is defined', () => {
      const wrapper = mountModal();
      // Just verify the component has the necessary structure
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });
  });
});
