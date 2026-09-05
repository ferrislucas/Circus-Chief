import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useProviderAllowancesStore } from '../stores/providerAllowances.js';
import { api } from '../composables/useApi.js';

vi.mock('../composables/useApi.js', () => ({
  api: { getProviderAllowances: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({ on: vi.fn(), off: vi.fn(), onReconnect: vi.fn(() => vi.fn()) }),
}));

import ProviderAllowanceIndicators from './ProviderAllowanceIndicators.vue';

describe('ProviderAllowanceIndicators', () => {
  let resizeObservers;
  let rectSpy;

  beforeEach(() => {
    setActivePinia(createPinia());
    api.getProviderAllowances.mockImplementation(() => new Promise(() => {}));
    resizeObservers = [];
    globalThis.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.disconnect = vi.fn();
        resizeObservers.push(this);
      }

      observe = vi.fn();
      trigger = () => this.callback();
    };
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
      const width = this.classList.contains('desktop-items') ? 190
        : this.classList.contains('allowance-item') ? 70
          : this.classList.contains('overflow-button') ? 30 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
  });

  afterEach(() => rectSpy.mockRestore());

  function seedSnapshots(count) {
    const store = useProviderAllowancesStore();
    store.snapshots = Array.from({ length: count }, (_, index) => ({
      providerId: `provider-${index}`,
      providerName: `Provider ${index + 1}`,
      status: 'ok',
      allowances: [],
    }));
  }

  it('renders nothing when the disabled allowance response is empty', async () => {
    api.getProviderAllowances.mockResolvedValueOnce([]);
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(false);
  });

  it('uses the container width to show complete items and reserves overflow control space', async () => {
    seedSnapshots(4);
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();
    resizeObservers[0].trigger();
    await nextTick();

    expect(wrapper.findAll('.desktop-items .allowance-item')).toHaveLength(2);
    expect(wrapper.find('.overflow-button').text()).toBe('+2');
  });

  it('re-measures when the container changes size and disconnects on unmount', async () => {
    seedSnapshots(4);
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();
    resizeObservers[0].trigger();
    await nextTick();
    expect(wrapper.findAll('.desktop-items .allowance-item')).toHaveLength(2);

    rectSpy.mockImplementation(function getBoundingClientRect() {
      const width = this.classList.contains('desktop-items') ? 310
        : this.classList.contains('allowance-item') ? 70
          : this.classList.contains('overflow-button') ? 30 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    resizeObservers[0].trigger();
    await nextTick();

    expect(wrapper.findAll('.desktop-items .allowance-item')).toHaveLength(4);
    expect(wrapper.find('.desktop-items .overflow-button').exists()).toBe(false);
    wrapper.unmount();
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
  });
});
