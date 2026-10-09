import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('./ProviderAllowanceIndicators.vue', () => ({ default: { template: '<div data-testid="provider-allowance-indicators" aria-live="polite">allowances</div>' } }));

import ProviderAllowanceFeature from './ProviderAllowanceFeature.vue';

describe('ProviderAllowanceFeature', () => {
  it('always mounts the indicators with no server gate', () => {
    const wrapper = mount(ProviderAllowanceFeature);
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(true);
  });
});
