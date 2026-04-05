import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';

const mockIsStale = ref(false);
const mockConnectionStatus = ref('connected');
const mockReconnectAttempt = ref(0);

vi.mock('../composables/useConnectionStatus.js', () => ({
  useConnectionStatus: () => ({
    isStale: mockIsStale,
    connectionStatus: mockConnectionStatus,
    reconnectAttempt: mockReconnectAttempt,
  }),
}));

import ConnectionBanner from './ConnectionBanner.vue';

describe('ConnectionBanner', () => {
  beforeEach(() => {
    mockIsStale.value = false;
    mockConnectionStatus.value = 'connected';
    mockReconnectAttempt.value = 0;
  });

  it('is not visible when connected (isStale=false)', () => {
    const wrapper = mount(ConnectionBanner);
    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('has a Transition wrapper', () => {
    const wrapper = mount(ConnectionBanner);
    // The Transition component is rendered in the vnode tree
    expect(wrapper.findComponent({ name: 'Transition' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows banner when isStale is true and status is reconnecting (amber/warning styling)', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'reconnecting';
    mockReconnectAttempt.value = 1;

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.classes()).toContain('banner-warning');
    wrapper.unmount();
  });

  it('shows correct text with attempt count for reconnecting state', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'reconnecting';
    mockReconnectAttempt.value = 3;

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.text()).toContain('Connection lost');
    expect(banner.text()).toContain('reconnecting');
    expect(banner.text()).toContain('attempt 3');
    wrapper.unmount();
  });

  it('shows reconnecting text without attempt count when attempt is 0', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'reconnecting';
    mockReconnectAttempt.value = 0;

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.text()).toContain('Connection lost');
    expect(banner.text()).not.toContain('attempt');
    wrapper.unmount();
  });

  it('shows banner with error styling when disconnected', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'disconnected';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.classes()).toContain('banner-error');
    wrapper.unmount();
  });

  it('shows "Disconnected from server" text for disconnected state', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'disconnected';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.text()).toContain('Disconnected from server');
    wrapper.unmount();
  });

  it('hides banner when status returns to connected', async () => {
    // Start disconnected and stale
    mockIsStale.value = true;
    mockConnectionStatus.value = 'disconnected';

    const wrapper = mount(ConnectionBanner);
    await nextTick();
    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(true);

    // Reconnect
    mockIsStale.value = false;
    mockConnectionStatus.value = 'connected';
    await nextTick();

    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('has data-testid="connection-banner" on the banner element', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'reconnecting';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.exists()).toBe(true);
    wrapper.unmount();
  });

  it('contains a pulsing dot element when reconnecting', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'reconnecting';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const dot = wrapper.find('.banner-dot');
    expect(dot.exists()).toBe(true);
    expect(dot.classes()).toContain('dot-pulse');
    wrapper.unmount();
  });

  it('contains a static dot element when disconnected', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'disconnected';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const dot = wrapper.find('.banner-dot');
    expect(dot.exists()).toBe(true);
    expect(dot.classes()).not.toContain('dot-pulse');
    wrapper.unmount();
  });

  it('has role="alert" for accessibility', async () => {
    mockIsStale.value = true;
    mockConnectionStatus.value = 'disconnected';

    const wrapper = mount(ConnectionBanner);
    await nextTick();

    const banner = wrapper.find('[data-testid="connection-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.attributes('role')).toBe('alert');
    wrapper.unmount();
  });
});
