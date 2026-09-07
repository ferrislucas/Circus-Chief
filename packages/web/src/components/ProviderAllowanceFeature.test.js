import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const { getServerInfo } = vi.hoisted(() => ({ getServerInfo: vi.fn() }));
vi.mock('../composables/useApi.js', () => ({ api: { getServerInfo } }));
vi.mock('./ProviderAllowanceIndicators.vue', () => ({ default: { template: '<div data-testid="provider-allowance-indicators" aria-live="polite">allowances</div>' } }));

import ProviderAllowanceFeature from './ProviderAllowanceFeature.vue';

describe('ProviderAllowanceFeature', () => {
  beforeEach(() => getServerInfo.mockReset());
  afterEach(() => document.body.replaceChildren());

  it('mounts no allowance UI, dialog, or live region when capability is disabled', async () => {
    getServerInfo.mockResolvedValue({ providerAllowancesEnabled: false });
    const wrapper = mount(ProviderAllowanceFeature, { attachTo: document.body });
    await Promise.resolve();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(false);
    expect(document.querySelector('[role="dialog"], [aria-live]')).toBeNull();
  });

  it('mounts the indicator only after the server explicitly enables the capability', async () => {
    getServerInfo.mockResolvedValue({ providerAllowancesEnabled: true });
    const wrapper = mount(ProviderAllowanceFeature);
    await Promise.resolve();
    await nextTick();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(true);
  });
});
