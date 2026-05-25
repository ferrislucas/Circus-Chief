import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CircusTimeTab from './CircusTimeTab.vue';

describe('CircusTimeTab', () => {
  it('renders the Circus Time CTA content', () => {
    const wrapper = mount(CircusTimeTab);

    expect(wrapper.find('h3').text()).toContain('Circus Time');

    const text = wrapper.text();
    expect(text).toContain('Configure recurring tasks that invoke templates');
    expect(text).toContain('make HTTP calls, or execute commands');
    expect(text).toContain('The Circus Time add-on is still in development.');
    expect(text).toContain('If Circus Chief is useful to you');
    expect(text).toContain('purchasing an early Circus Time license');
    expect(text).toContain('helps fund both Circus Chief and the Circus Time add-on');
  });

  it('links to the Circus Time checkout in a new tab', () => {
    const wrapper = mount(CircusTimeTab);
    const link = wrapper.get('a');

    expect(link.attributes('href')).toBe('https://mydayoff.lemonsqueezy.com/checkout');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });
});
