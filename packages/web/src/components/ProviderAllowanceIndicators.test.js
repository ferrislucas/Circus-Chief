import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../composables/useApi.js', () => ({
  api: { getProviderAllowances: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({ on: vi.fn(), off: vi.fn(), onReconnect: vi.fn(() => vi.fn()) }),
}));

import ProviderAllowanceIndicators from './ProviderAllowanceIndicators.vue';

describe('ProviderAllowanceIndicators', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('renders nothing when the disabled allowance response is empty', async () => {
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(false);
  });
});
