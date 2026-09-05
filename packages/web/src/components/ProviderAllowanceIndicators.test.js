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

  afterEach(() => {
    rectSpy.mockRestore();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function seedSnapshots(count) {
    const store = useProviderAllowancesStore();
    store.snapshots = Array.from({ length: count }, (_, index) => ({
      providerId: `provider-${index}`,
      providerName: `Provider ${index + 1}`,
      status: 'ok',
      allowances: [],
    }));
  }

  function snapshot({ providerId = 'openai', status = 'ok', resetsAt = null } = {}) {
    return {
      providerId,
      providerName: providerId === 'openai' ? 'OpenAI' : providerId,
      providerKind: 'openai',
      status,
      source: 'provider',
      updatedAt: null,
      staleAt: null,
      unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt }],
    };
  }

  it('renders nothing when the disabled allowance response is empty', async () => {
    api.getProviderAllowances.mockResolvedValueOnce([]);
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await Promise.resolve();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(false);
  });

  it('formats percentage-only allowance data without pretending null values are quantities', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [{
      providerId: 'openai', providerName: 'OpenAI', providerKind: 'openai', status: 'available', source: 'provider', updatedAt: null, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: null, limit: null, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    }];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    resizeObservers[0].trigger();
    await nextTick();
    await wrapper.find('.desktop-items .allowance-item').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('25% remaining');
    expect(wrapper.text()).not.toContain('null / null');
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

  it('traps focus in the dialog, closes on document Escape, and restores the invoking trigger', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot()];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    resizeObservers[0].trigger();
    await nextTick();
    const trigger = wrapper.find('.desktop-items .allowance-item');
    trigger.element.focus();
    await trigger.trigger('click');
    await nextTick();

    const closeButton = wrapper.find('.close-button').element;
    expect(document.activeElement).toBe(wrapper.find('[role="dialog"]').element);
    closeButton.focus();
    closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(closeButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it('includes reset time in compact item labels and politely announces only critical/exhausted transitions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({ resetsAt: '2026-01-03T03:04:05Z' })];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();
    resizeObservers[0].trigger();
    await nextTick();

    expect(wrapper.find('.desktop-items .allowance-item').attributes('aria-label')).toContain('resets');
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('');

    store.replace(snapshot({ status: 'warning' }));
    await nextTick();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('');

    store.replace(snapshot({ status: 'critical' }));
    store.replace(snapshot({ status: 'exhausted' }));
    await nextTick();
    await vi.runAllTimersAsync();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('OpenAI usage is exhausted.');
  });
});
