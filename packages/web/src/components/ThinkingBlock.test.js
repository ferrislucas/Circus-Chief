import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';

async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('ThinkingBlock', () => {
  function mountComponent(props) {
    return mount(ThinkingBlock, { props });
  }

  it('renders short content in full', () => {
    const wrapper = mountComponent({ content: 'short thought' });
    expect(wrapper.find('.thinking-text').text()).toBe('short thought');
    expect(wrapper.find('.show-more-btn').exists()).toBe(false);
  });

  it('head-truncates long content by default (completed history)', () => {
    const content = `${'A'.repeat(500)}TAIL-MARKER`;
    const wrapper = mountComponent({ content });
    const text = wrapper.find('.thinking-text').text();
    expect(text.startsWith('A'.repeat(500))).toBe(true);
    expect(text.endsWith('...')).toBe(true);
    expect(text).not.toContain('TAIL-MARKER');
  });

  it('tail-truncates long content when tail is true (live pane)', () => {
    const content = `HEAD-MARKER${'A'.repeat(500)}TAIL-MARKER`;
    const wrapper = mountComponent({ content, tail: true });
    const text = wrapper.find('.thinking-text').text();
    expect(text.startsWith('...')).toBe(true);
    expect(text).toContain('TAIL-MARKER');
    expect(text).not.toContain('HEAD-MARKER');
  });

  it('shows full content when expanded regardless of tail', async () => {
    const content = `HEAD-MARKER${'A'.repeat(500)}TAIL-MARKER`;
    for (const tail of [false, true]) {
      const wrapper = mountComponent({ content, tail });
      await wrapper.find('.show-more-btn').trigger('click');
      await flushAll(wrapper);
      expect(wrapper.find('.thinking-text').text()).toBe(content);
      expect(wrapper.find('.show-more-btn').text()).toBe('Show less');
    }
  });

  it('defaults tail to false', () => {
    const wrapper = mountComponent({ content: 'x' });
    expect(wrapper.props('tail')).toBe(false);
  });
});
